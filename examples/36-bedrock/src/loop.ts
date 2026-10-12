import type { Failure } from "@aih/example-17-ai/src/contract.ts";
import { classifyError, nextDelayMs, type RetryPolicy } from "@aih/example-17-ai/src/failure.ts";

import type { AssistantEvent } from "./contract.ts";
import type { ContentBlock, Json, Message } from "./converse.ts";
import type { ModelGateway } from "./gateway.ts";
import { buildAssistantRequest, type RequestOptions } from "./prompt.ts";
import { callTool, type Tools } from "./tools.ts";
import { type RawToolUse, readTurn, type Turn } from "./turn.ts";
import { addUsage, NO_USAGE, totalTokens, type Usage } from "./usage.ts";

// #region limits
export type Limits = {
  /** Answers read from the model for one question, the last one included. */
  maxTurns: number;
  /** Tool requests carried out per answer. The rest are refused. */
  maxToolCallsPerTurn: number;
  /** Tool requests refused (unknown tool, bad input) before the loop gives up. */
  maxToolErrors: number;
  /** Tokens reported across all turns after which no further call is made. */
  maxTotalTokens: number;
};
// #endregion limits

// #region state
/** Everything the loop knows between two calls to the model. */
export type LoopState = { turns: number; usage: Usage; toolErrors: number };

export type Step =
  | { do: "finish"; stopReason: string; complete: boolean }
  // The guardrail answered in the model's place.
  | { do: "block" }
  | { do: "fail"; failure: Failure }
  // Send the same request again: nothing from this attempt has been acted on.
  | { do: "retry" }
  | { do: "call_tools"; run: RawToolUse[]; refuse: RawToolUse[] };

const badOutput: Failure = { code: "bad_output", retryable: false };
// #endregion state

// #region decide
/**
 * What to do with one answer. `state` already counts this turn. `sentText` says whether
 * any of this attempt's text has reached the caller, and `mayRetry` whether another
 * attempt is still allowed.
 */
export function decide(
  state: LoopState,
  turn: Turn,
  limits: Limits,
  attempt: { sentText: boolean; mayRetry: boolean },
): Step {
  if (turn.kind === "failed") {
    // Text that was sent cannot be taken back, so the attempt cannot be replaced by another.
    return turn.failure.retryable && !attempt.sentText && attempt.mayRetry
      ? { do: "retry" }
      : { do: "fail", failure: turn.failure };
  }
  switch (turn.stopReason) {
    case "end_turn":
      return turn.text.trim() === ""
        ? { do: "fail", failure: badOutput }
        : { do: "finish", stopReason: "end_turn", complete: true };
    case "guardrail_intervened":
      return { do: "block" };
    case "malformed_tool_use":
    case "malformed_model_output":
      return { do: "fail", failure: badOutput };
    case "tool_use": {
      if (turn.toolUses.length === 0) {
        return { do: "fail", failure: badOutput };
      }
      // The model wants to go on. These two lines are what stops it.
      if (state.turns >= limits.maxTurns) {
        return { do: "finish", stopReason: "turn_limit", complete: false };
      }
      if (totalTokens(state.usage) >= limits.maxTotalTokens) {
        return { do: "finish", stopReason: "token_limit", complete: false };
      }
      return {
        do: "call_tools",
        run: turn.toolUses.slice(0, limits.maxToolCallsPerTurn),
        refuse: turn.toolUses.slice(limits.maxToolCallsPerTurn),
      };
    }
    default:
      // max_tokens, stop_sequence, content_filtered, model_context_window_exceeded,
      // or a reason added after this was written: the answer is not whole.
      return { do: "finish", stopReason: turn.stopReason, complete: false };
  }
}
// #endregion decide

// #region echo
function parseInput(inputJson: string): Json {
  try {
    return inputJson.trim() === "" ? {} : (JSON.parse(inputJson) as Json);
  } catch {
    // The next request has to repeat the tool request it answers, and `input` must be JSON.
    return {};
  }
}

/** The model's answer as the next request repeats it. */
export function assistantMessage(turn: Extract<Turn, { kind: "message" }>): Message {
  const content: ContentBlock[] = turn.text === "" ? [] : [{ text: turn.text }];
  for (const { toolUseId, name, inputJson } of turn.toolUses) {
    content.push({ toolUse: { toolUseId, name, input: parseInput(inputJson) } });
  }
  return { role: "assistant", content };
}
// #endregion echo

export type AssistantDeps = {
  gateway: ModelGateway;
  request: RequestOptions;
  limits: Limits;
  /** Attempts per turn. Every attempt of every turn shares the one deadline below. */
  retry: RetryPolicy;
  timeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  /** `AbortSignal.timeout` in production. */
  timeoutSignal: (ms: number) => AbortSignal;
};

export type Assistant = (
  question: string,
  tools: Tools,
  caller: AbortSignal,
) => AsyncGenerator<AssistantEvent, void, void>;

// #region loop
/** Asks the model, runs what it asks for, and asks again, until it answers or a limit says stop. */
export function createAssistant(deps: AssistantDeps): Assistant {
  return async function* (question, tools, caller) {
    const timeout = deps.timeoutSignal(deps.timeoutMs);
    // Leaving the loop for any reason aborts the call in progress.
    const finished = new AbortController();
    const signal = AbortSignal.any([caller, timeout, finished.signal]);
    const stopped = (): Failure | undefined =>
      caller.aborted
        ? { code: "cancelled", retryable: false }
        : timeout.aborted
          ? { code: "timeout", retryable: true }
          : undefined;

    const messages: Message[] = [{ role: "user", content: [{ text: question }] }];
    let state: LoopState = { turns: 0, usage: NO_USAGE, toolErrors: 0 };
    const error = (failure: Failure): AssistantEvent => ({
      type: "error",
      ...failure,
      turns: state.turns,
      usage: state.usage,
    });

    try {
      for (let attempt = 1; ;) {
        let turn: Turn;
        let sentText = false;
        try {
          const request = buildAssistantRequest(messages, tools, deps.request);
          const reader = readTurn(await deps.gateway.converseStream(request, signal), stopped);
          let next = await reader.next();
          while (next.done !== true) {
            sentText = true;
            yield { type: "delta", text: next.value };
            next = await reader.next();
          }
          turn = next.value;
        } catch (thrown) {
          // The call was refused before any event: throttling, a wrong model ID, no permission.
          const failure = stopped() ??
            classifyError(thrown) ?? { code: "internal", retryable: false };
          turn = { kind: "failed", failure, text: "" };
        }

        if (turn.kind === "message") {
          state = {
            ...state,
            turns: state.turns + 1,
            usage: turn.usage === null ? state.usage : addUsage(state.usage, turn.usage),
          };
        }
        const delay =
          turn.kind === "failed" && stopped() === undefined
            ? nextDelayMs(turn.failure, attempt, deps.retry, deps.random)
            : null;
        const step = decide(state, turn, deps.limits, { sentText, mayRetry: delay !== null });

        if (step.do === "retry") {
          await deps.sleep(delay ?? 0);
          attempt += 1;
          continue;
        }
        if (step.do === "fail") {
          yield error(step.failure);
          return;
        }
        if (turn.kind !== "message") {
          // Not reachable: a failed turn is retried or reported above.
          return;
        }
        if (step.do === "block") {
          yield { type: "blocked", text: turn.text };
          yield { type: "done", stopReason: turn.stopReason, complete: false, ...summary(state) };
          return;
        }
        if (step.do === "finish") {
          yield {
            type: "done",
            stopReason: step.stopReason,
            complete: step.complete,
            ...summary(state),
          };
          return;
        }

        // The tools run one after another, in the order the model asked for them.
        const results: ContentBlock[] = [];
        for (const request of step.run) {
          const outcome = await callTool(tools, request);
          state = { ...state, toolErrors: state.toolErrors + (outcome.ok ? 0 : 1) };
          results.push(outcome.result);
          yield { type: "tool", name: outcome.name, ok: outcome.ok };
        }
        for (const request of step.refuse) {
          state = { ...state, toolErrors: state.toolErrors + 1 };
          results.push({
            toolResult: {
              toolUseId: request.toolUseId,
              content: [{ text: "Too many tool requests in one answer. This one was not run." }],
              status: "error",
            },
          });
          yield { type: "tool", name: request.name, ok: false };
        }
        if (state.toolErrors > deps.limits.maxToolErrors) {
          yield error(badOutput);
          return;
        }
        // Every tool request of the answer gets its result in the one message that follows it.
        messages.push(assistantMessage(turn), { role: "user", content: results });
        attempt = 1;
      }
    } finally {
      finished.abort();
    }
  };
}

const summary = (state: LoopState) => ({ turns: state.turns, usage: state.usage });
// #endregion loop
