import * as v from "valibot";

import type { Message } from "@aih/example-36-bedrock/src/converse.ts";

// #region event
/** One finished exchange. The only thing a session remembers. */
export const turnEventSchema = v.object({
  type: v.literal("turn"),
  /** 1 for the first exchange of the session, then 2, 3, ... */
  seq: v.pipe(v.number(), v.integer(), v.minValue(1)),
  question: v.string(),
  answer: v.string(),
});
export type TurnEvent = v.InferOutput<typeof turnEventSchema>;
// #endregion event

// #region state
export type SessionState = {
  /** How many exchanges the session has had. The next one is `turns + 1`. */
  turns: number;
  /** The latest exchanges, oldest first. Older ones are forgotten. */
  window: { question: string; answer: string }[];
};

export const EMPTY: SessionState = { turns: 0, window: [] };

/** Each remembered exchange is sent to the model again with every later question. */
export const MAX_REMEMBERED_TURNS = 6;
export const MAX_REMEMBERED_ANSWER_CHARS = 2_000;
// #endregion state

// #region reduce
/**
 * The state after one more event. Only the next exchange in line changes anything: a
 * repeated event (a retried write) and an event that arrives ahead of a missing one are
 * both left out, so the same events give the same state however often they are delivered.
 */
export function reduce(state: SessionState, event: TurnEvent): SessionState {
  if (event.seq !== state.turns + 1) {
    return state;
  }
  const answer = event.answer.slice(0, MAX_REMEMBERED_ANSWER_CHARS);
  return {
    turns: event.seq,
    window: [...state.window, { question: event.question, answer }].slice(-MAX_REMEMBERED_TURNS),
  };
}

/** The state a stored log stands for, whatever order the store returned it in. */
export function replay(events: readonly TurnEvent[]): SessionState {
  return events.toSorted((a, b) => a.seq - b.seq).reduce(reduce, EMPTY);
}
// #endregion reduce

// #region history
/**
 * The remembered exchanges as the messages that go in front of a new question. Text only:
 * what a tool returned in an earlier exchange is not kept, so a note is read again, with
 * today's caller, every time it is needed.
 */
export function toHistory(state: SessionState): Message[] {
  return state.window.flatMap(({ question, answer }): Message[] => [
    { role: "user", content: [{ text: question }] },
    { role: "assistant", content: [{ text: answer }] },
  ]);
}
// #endregion history
