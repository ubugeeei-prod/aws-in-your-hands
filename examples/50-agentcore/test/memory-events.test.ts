import { describe, expect, it } from "vite-plus/test";

import { fromStoredEvents, toCreateEventInput } from "../src/memory-events.ts";
import type { TurnEvent } from "../src/session.ts";
import { ALICE, BOB, SESSION_A, SESSION_B } from "./helpers.ts";

const event: TurnEvent = {
  type: "turn",
  seq: 2,
  question: "何が残っている？",
  answer: "負荷試験です。",
};
const at = new Date("2026-10-13T00:00:00.000Z");

describe("an exchange as an AgentCore Memory event", () => {
  it("is written under the actor and the session, with a token that makes a retry harmless", () => {
    const input = toCreateEventInput("mem-1", ALICE, SESSION_A, event, at);
    expect(input).toMatchObject({ memoryId: "mem-1", actorId: ALICE, sessionId: SESSION_A });
    expect(input.clientToken).toBe(`${SESSION_A}.turn-2`);
    expect(input.clientToken).toBe(
      toCreateEventInput("mem-1", ALICE, SESSION_A, event, new Date()).clientToken,
    );
    expect(input.payload).toEqual([
      { conversational: { role: "USER", content: { text: "何が残っている？" } } },
      { conversational: { role: "ASSISTANT", content: { text: "負荷試験です。" } } },
    ]);
  });

  it("comes back as it went in", () => {
    const { payload, metadata } = toCreateEventInput("mem-1", ALICE, SESSION_A, event, at);
    const stored = {
      memoryId: "mem-1",
      actorId: ALICE,
      sessionId: SESSION_A,
      eventId: "e1",
      eventTimestamp: at,
      payload,
      metadata,
    };
    expect(fromStoredEvents([stored], ALICE, SESSION_A)).toEqual([event]);
  });

  it("skips what it did not write, and what belongs to another actor or session", () => {
    const { payload, metadata } = toCreateEventInput("mem-1", ALICE, SESSION_A, event, at);
    const mine = { actorId: ALICE, sessionId: SESSION_A, payload, metadata };
    expect(
      fromStoredEvents(
        [
          { ...mine, metadata: {} },
          { ...mine, metadata: { seq: { stringValue: "0" } } },
          { ...mine, metadata: { seq: { stringValue: "two" } } },
          { ...mine, payload: [payload?.[0]] },
          { ...mine, payload: [{ blob: "something else" }, payload?.[1]] },
          { ...mine, actorId: BOB },
          { ...mine, sessionId: SESSION_B },
          null,
          "event",
        ],
        ALICE,
        SESSION_A,
      ),
    ).toEqual([]);
  });
});
