import * as v from "valibot";

import type { Failure } from "@aih/example-17-ai/src/contract.ts";
import { exceptionNameIn } from "@aih/example-17-ai/src/converse-stream.ts";
import { classifyError, failureByName } from "@aih/example-17-ai/src/failure.ts";

import { streamEventSchema } from "./converse.ts";
import type { Usage } from "./usage.ts";

// #region turn
/** A tool request as it arrived: the input is still the text the model wrote. */
export type RawToolUse = { toolUseId: string; name: string; inputJson: string };

/** One answer from the model, read to its end. */
export type Turn =
  | {
      kind: "message";
      stopReason: string;
      text: string;
      toolUses: RawToolUse[];
      /** Null when the stream closed before its metadata event. */
      usage: Usage | null;
    }
  // The stream did not reach `messageStop`. Nothing in it can be acted on.
  | { kind: "failed"; failure: Failure; text: string };

const interrupted: Failure = { code: "interrupted", retryable: true };
const badOutput: Failure = { code: "bad_output", retryable: false };

/** Stops a model that ignores maxTokens, and a tool input that never ends. */
export const MAX_TURN_CHARS = 20_000;

/**
 * Reads one ConverseStream to its end. Text is yielded as it arrives. Tool requests are
 * only returned, whole, after `messageStop`, so a stream cut in the middle of one never
 * runs a tool.
 */
export async function* readTurn(
  stream: AsyncIterable<unknown>,
  stopped: () => Failure | undefined,
): AsyncGenerator<string, Turn, void> {
  let text = "";
  let chars = 0;
  let stopReason: string | undefined;
  let usage: Usage | null = null;
  // Keyed by contentBlockIndex. A tool request is one start event and any number of deltas.
  const toolUses = new Map<number, RawToolUse>();
  try {
    for await (const raw of stream) {
      const parsed = v.safeParse(streamEventSchema, raw);
      if (!parsed.success) {
        return { kind: "failed", failure: badOutput, text };
      }
      const event = parsed.output;
      const exception = exceptionNameIn(event);
      if (exception !== undefined) {
        return { kind: "failed", failure: failureByName(exception) ?? interrupted, text };
      }

      const start = event.contentBlockStart;
      if (start?.start.toolUse !== undefined) {
        const { toolUseId, name } = start.start.toolUse;
        toolUses.set(start.contentBlockIndex ?? 0, { toolUseId, name, inputJson: "" });
      }

      const delta = event.contentBlockDelta;
      if (delta !== undefined) {
        const piece = delta.delta.text ?? delta.delta.toolUse?.input ?? "";
        chars += piece.length;
        if (chars > MAX_TURN_CHARS) {
          return { kind: "failed", failure: badOutput, text };
        }
        if (delta.delta.toolUse !== undefined) {
          const open = toolUses.get(delta.contentBlockIndex ?? 0);
          if (open === undefined) {
            // Input for a tool request that never started.
            return { kind: "failed", failure: badOutput, text };
          }
          open.inputJson += delta.delta.toolUse.input;
        } else if (piece !== "") {
          text += piece;
          yield piece;
        }
      }

      stopReason = event.messageStop?.stopReason ?? stopReason;
      if (event.metadata !== undefined) {
        const { inputTokens, outputTokens, cacheReadInputTokens, cacheWriteInputTokens } =
          event.metadata.usage;
        usage = {
          inputTokens,
          outputTokens,
          cacheReadInputTokens: cacheReadInputTokens ?? 0,
          cacheWriteInputTokens: cacheWriteInputTokens ?? 0,
        };
      }
    }
  } catch (error) {
    return { kind: "failed", failure: stopped() ?? classifyError(error) ?? interrupted, text };
  }
  if (stopReason === undefined) {
    // The stream ended without saying why. A half-written tool request may be in it.
    return { kind: "failed", failure: interrupted, text };
  }
  return { kind: "message", stopReason, text, toolUses: [...toolUses.values()], usage };
}
// #endregion turn
