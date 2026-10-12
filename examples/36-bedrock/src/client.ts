import * as v from "valibot";

import { sseData } from "@aih/example-17-ai/src/client.ts";

import { type AssistantEvent, assistantEventSchema } from "./contract.ts";
import type { Usage } from "./usage.ts";

// #region events
/** The events of one answer, checked against the contract. Stops at the first that does not fit. */
export async function* assistantEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AssistantEvent, void, void> {
  try {
    for await (const data of sseData(body)) {
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        return;
      }
      const event = v.safeParse(assistantEventSchema, json);
      if (!event.success) {
        return;
      }
      yield event.output;
      if (event.output.type === "done" || event.output.type === "error") {
        return;
      }
    }
  } catch {
    // The connection failed while reading. No `done` arrived, and that is the answer.
  }
}
// #endregion events

// #region collect
export type Answer =
  | { status: "complete"; text: string; turns: number; usage: Usage }
  // The guardrail's message. It replaces whatever text came before it.
  | { status: "blocked"; text: string; usage: Usage }
  // `partial` may be shown as unfinished. It is not the answer.
  | { status: "incomplete"; partial: string; reason: string; retryable: boolean };

/** As in chapter 17: only a `done` that says `complete` makes the text an answer. */
export async function collectAnswer(
  events: AsyncIterable<AssistantEvent>,
  onEvent: (event: AssistantEvent) => void = () => {},
): Promise<Answer> {
  let text = "";
  let blocked: string | undefined;
  for await (const event of events) {
    onEvent(event);
    if (event.type === "delta") {
      text += event.text;
    } else if (event.type === "blocked") {
      blocked = event.text;
    } else if (event.type === "done") {
      if (blocked !== undefined) {
        return { status: "blocked", text: blocked, usage: event.usage };
      }
      return event.complete
        ? { status: "complete", text, turns: event.turns, usage: event.usage }
        : { status: "incomplete", partial: text, reason: event.stopReason, retryable: false };
    } else if (event.type === "error") {
      return {
        status: "incomplete",
        partial: text,
        reason: event.code,
        retryable: event.retryable,
      };
    }
  }
  return { status: "incomplete", partial: text, reason: "interrupted", retryable: true };
}
// #endregion collect
