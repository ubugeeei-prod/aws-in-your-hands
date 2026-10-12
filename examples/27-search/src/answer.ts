import * as v from "valibot";

import type { Failure, Usage } from "@aih/example-17-ai/src/contract.ts";
import {
  converseStreamEventSchema,
  exceptionNameIn,
} from "@aih/example-17-ai/src/converse-stream.ts";
import {
  classifyError,
  failureByName,
  nextDelayMs,
  type RetryPolicy,
} from "@aih/example-17-ai/src/failure.ts";
import type { ModelGateway } from "@aih/example-17-ai/src/summarize.ts";

import type { AnswerEvent, Source } from "./contract.ts";
import { buildAnswerRequest, citationsIn } from "./prompt.ts";
import type { Search } from "./search.ts";

export const MAX_ANSWER_CHARS = 4_000;
/** How many passages the model is shown. Each is at most about 920 characters. */
export const MAX_SOURCES = 4;

export type AnswerDeps = {
  search: Search;
  gateway: ModelGateway;
  modelId: string;
  maxOutputTokens: number;
  timeoutMs: number;
  retry: RetryPolicy;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  timeoutSignal: (ms: number) => AbortSignal;
};

export type AnswerStart =
  | { ok: true; attempts: number; events: AsyncGenerator<AnswerEvent, void, void> }
  | { ok: false; attempts: number; failure: Failure };

export type Answer = (owner: string, question: string, caller: AbortSignal) => Promise<AnswerStart>;

const interrupted: Failure = { code: "interrupted", retryable: true };

// #region answer
/**
 * Retrieval first, with the caller's owner. The model sees only what that search
 * returned, so it cannot quote a note the caller could not have found.
 */
export function createAnswerer(deps: AnswerDeps): Answer {
  return async (owner, question, caller) => {
    const found = await deps.search(owner, question, MAX_SOURCES);
    const sources: Source[] = found.passages.map((passage, index) => ({
      n: index + 1,
      noteId: passage.noteId,
      title: passage.title,
    }));
    if (sources.length === 0) {
      // Nothing to ground an answer in. Calling the model anyway would invite a guess, and a bill.
      return { ok: true, attempts: 0, events: nothingFound() };
    }

    const timeout = deps.timeoutSignal(deps.timeoutMs);
    const finished = new AbortController();
    const signal = AbortSignal.any([caller, timeout, finished.signal]);
    const stopped = (): Failure | undefined =>
      caller.aborted
        ? { code: "cancelled", retryable: false }
        : timeout.aborted
          ? { code: "timeout", retryable: true }
          : undefined;

    const request = buildAnswerRequest(question, found.passages, deps);
    for (let attempt = 1; ; attempt += 1) {
      try {
        const stream = await deps.gateway.converseStream(request, signal);
        return {
          ok: true,
          attempts: attempt,
          events: relay(stream, sources, stopped, finished),
        };
      } catch (error) {
        const failure = stopped() ?? classifyError(error) ?? { code: "internal", retryable: false };
        const delay =
          stopped() === undefined ? nextDelayMs(failure, attempt, deps.retry, deps.random) : null;
        if (delay === null) {
          finished.abort();
          return { ok: false, attempts: attempt, failure };
        }
        await deps.sleep(delay);
      }
    }
  };
}
// #endregion answer

async function* nothingFound(): AsyncGenerator<AnswerEvent, void, void> {
  yield { type: "sources", sources: [] };
  yield {
    type: "done",
    stopReason: "no_sources",
    complete: false,
    usage: null,
    citations: [],
    unknownCitations: [],
  };
}

// #region relay
/** The sources, then the model's text as it arrives, then which sources the text cited. */
async function* relay(
  stream: AsyncIterable<unknown>,
  sources: Source[],
  stopped: () => Failure | undefined,
  finished: AbortController,
): AsyncGenerator<AnswerEvent, void, void> {
  yield { type: "sources", sources };
  let stopReason: string | undefined;
  let usage: Usage | null = null;
  let answer = "";
  try {
    for await (const raw of stream) {
      const parsed = v.safeParse(converseStreamEventSchema, raw);
      if (!parsed.success) {
        yield { type: "error", code: "bad_output", retryable: false };
        return;
      }
      const event = parsed.output;
      const exception = exceptionNameIn(event);
      if (exception !== undefined) {
        yield { type: "error", ...(failureByName(exception) ?? interrupted) };
        return;
      }
      const text = event.contentBlockDelta?.delta.text;
      if (text !== undefined && text !== "") {
        answer += text;
        if (answer.length > MAX_ANSWER_CHARS) {
          yield { type: "error", code: "bad_output", retryable: false };
          return;
        }
        yield { type: "delta", text };
      }
      stopReason = event.messageStop?.stopReason ?? stopReason;
      if (event.metadata !== undefined) {
        usage = {
          inputTokens: event.metadata.usage.inputTokens,
          outputTokens: event.metadata.usage.outputTokens,
        };
      }
    }
  } catch (error) {
    yield { type: "error", ...(stopped() ?? classifyError(error) ?? interrupted) };
    return;
  } finally {
    finished.abort();
  }
  if (stopReason === undefined) {
    yield { type: "error", ...interrupted };
    return;
  }
  // Checked against the sources that were sent, not against what the model claims exists.
  yield {
    type: "done",
    stopReason,
    complete: stopReason === "end_turn",
    usage,
    ...citationsIn(answer, sources.length),
  };
}
// #endregion relay
