import * as v from "valibot";

import type { Failure, SummarizeRequest, SummaryEvent, Usage } from "./contract.ts";
import { converseStreamEventSchema, exceptionNameIn } from "./converse-stream.ts";
import { classifyError, failureByName, nextDelayMs, type RetryPolicy } from "./failure.ts";
import { buildSummaryRequest, type ConverseRequest } from "./prompt.ts";

// #region gateway
/** The one call this example makes to a model. Bedrock in production, a fixture in tests. */
export type ModelGateway = {
  /** Resolves when the model has accepted the request. The events arrive afterwards. */
  converseStream(request: ConverseRequest, signal: AbortSignal): Promise<AsyncIterable<unknown>>;
};
// #endregion gateway

/** A summary longer than this is not a summary. Stops a model that ignores maxTokens. */
export const MAX_SUMMARY_CHARS = 4_000;

export type SummarizeDeps = {
  gateway: ModelGateway;
  modelId: string;
  maxOutputTokens: number;
  timeoutMs: number;
  retry: RetryPolicy;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  /** `AbortSignal.timeout` in production. */
  timeoutSignal: (ms: number) => AbortSignal;
};

export type SummaryStart =
  | { ok: true; attempts: number; events: AsyncGenerator<SummaryEvent, void, void> }
  | { ok: false; attempts: number; failure: Failure };

export type Summarize = (note: SummarizeRequest, caller: AbortSignal) => Promise<SummaryStart>;

const interrupted: Failure = { code: "interrupted", retryable: true };

// #region start
/**
 * Opens the stream, retrying while nothing has reached the caller yet.
 * After the first event there are no more retries: the text already sent
 * cannot be taken back.
 */
export function createSummarizer(deps: SummarizeDeps): Summarize {
  return async (note, caller) => {
    const timeout = deps.timeoutSignal(deps.timeoutMs);
    // Ending the relay for any reason aborts the request to the model.
    const finished = new AbortController();
    const signal = AbortSignal.any([caller, timeout, finished.signal]);
    const stopped = (): Failure | undefined =>
      caller.aborted
        ? { code: "cancelled", retryable: false }
        : timeout.aborted
          ? { code: "timeout", retryable: true }
          : undefined;

    const request = buildSummaryRequest(note, deps);
    for (let attempt = 1; ; attempt += 1) {
      try {
        const stream = await deps.gateway.converseStream(request, signal);
        return { ok: true, attempts: attempt, events: relay(stream, stopped, finished) };
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
// #endregion start

// #region relay
/** Turns ConverseStream events into this API's events. Ends with exactly one `done` or `error`. */
async function* relay(
  stream: AsyncIterable<unknown>,
  stopped: () => Failure | undefined,
  finished: AbortController,
): AsyncGenerator<SummaryEvent, void, void> {
  let stopReason: string | undefined;
  let usage: Usage | null = null;
  let chars = 0;
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
        chars += text.length;
        if (chars > MAX_SUMMARY_CHARS) {
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
    // The stream ended without saying why. What arrived is not known to be whole.
    yield { type: "error", ...interrupted };
    return;
  }
  yield { type: "done", stopReason, complete: stopReason === "end_turn", usage };
}
// #endregion relay
