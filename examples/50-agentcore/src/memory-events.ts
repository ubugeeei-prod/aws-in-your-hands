import type { CreateEventInput } from "@aws-sdk/client-bedrock-agentcore";
import * as v from "valibot";

import type { TurnEvent } from "./session.ts";

// #region write
/** One exchange as a short-term memory event: the question, the answer, and its place in line. */
export function toCreateEventInput(
  memoryId: string,
  actorId: string,
  sessionId: string,
  event: TurnEvent,
  at: Date,
): CreateEventInput {
  return {
    memoryId,
    actorId,
    sessionId,
    eventTimestamp: at,
    payload: [
      { conversational: { role: "USER", content: { text: event.question } } },
      { conversational: { role: "ASSISTANT", content: { text: event.answer } } },
    ],
    metadata: { seq: { stringValue: String(event.seq) } },
    // The same exchange written twice (a retry after a lost answer) is stored once.
    clientToken: `${sessionId}.turn-${event.seq}`,
  };
}
// #endregion write

// #region read
const text = v.object({ content: v.object({ text: v.string() }) });

const storedSchema = v.object({
  actorId: v.string(),
  sessionId: v.string(),
  metadata: v.object({
    seq: v.object({
      stringValue: v.pipe(v.string(), v.regex(/^[1-9]\d{0,5}$/), v.transform(Number)),
    }),
  }),
  payload: v.tuple([
    v.object({ conversational: v.object({ role: v.literal("USER"), ...text.entries }) }),
    v.object({ conversational: v.object({ role: v.literal("ASSISTANT"), ...text.entries }) }),
  ]),
});

/**
 * The exchanges in what ListEvents returned. An event of another shape (written by another
 * program, or by a later version of this one) is skipped. An event that names another actor
 * or session than the one asked for is skipped too: the question was "this actor's session",
 * and the answer is not taken on trust.
 */
export function fromStoredEvents(
  events: readonly unknown[],
  actorId: string,
  sessionId: string,
): TurnEvent[] {
  return events.flatMap((raw): TurnEvent[] => {
    const parsed = v.safeParse(storedSchema, raw);
    if (!parsed.success) {
      return [];
    }
    const { metadata, payload } = parsed.output;
    if (parsed.output.actorId !== actorId || parsed.output.sessionId !== sessionId) {
      return [];
    }
    return [
      {
        type: "turn",
        seq: metadata.seq.stringValue,
        question: payload[0].conversational.content.text,
        answer: payload[1].conversational.content.text,
      },
    ];
  });
}
// #endregion read
