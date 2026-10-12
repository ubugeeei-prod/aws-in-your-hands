import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY,
  MAX_REMEMBERED_ANSWER_CHARS,
  MAX_REMEMBERED_TURNS,
  reduce,
  replay,
  toHistory,
  type TurnEvent,
} from "../src/session.ts";

const turn = (seq: number, answer = `answer ${seq}`): TurnEvent => ({
  type: "turn",
  seq,
  question: `question ${seq}`,
  answer,
});

describe("reduce", () => {
  it("adds the next exchange and nothing else", () => {
    const one = reduce(EMPTY, turn(1));
    expect(one).toEqual({ turns: 1, window: [{ question: "question 1", answer: "answer 1" }] });
    // A retried write delivers the same exchange again.
    expect(reduce(one, turn(1, "another answer"))).toBe(one);
    // An exchange that arrives ahead of a missing one is not built on.
    expect(reduce(one, turn(3))).toBe(one);
    expect(reduce(EMPTY, turn(2))).toBe(EMPTY);
  });

  it("does not change the state it was given", () => {
    const before = reduce(EMPTY, turn(1));
    const snapshot = structuredClone(before);
    reduce(before, turn(2));
    expect(before).toEqual(snapshot);
  });

  it("forgets the oldest exchange once the window is full, and still counts it", () => {
    const state = replay(Array.from({ length: MAX_REMEMBERED_TURNS + 3 }, (_, i) => turn(i + 1)));
    expect(state.turns).toBe(MAX_REMEMBERED_TURNS + 3);
    expect(state.window).toHaveLength(MAX_REMEMBERED_TURNS);
    expect(state.window[0]?.question).toBe("question 4");
  });

  it("keeps a bounded part of a long answer", () => {
    const state = reduce(EMPTY, turn(1, "あ".repeat(MAX_REMEMBERED_ANSWER_CHARS + 500)));
    expect(state.window[0]?.answer).toHaveLength(MAX_REMEMBERED_ANSWER_CHARS);
  });
});

describe("replay", () => {
  it("gives the same state for the same events in any order, delivered any number of times", () => {
    const events = [turn(1), turn(2), turn(3)];
    const expected = replay(events);
    expect(replay([turn(3), turn(1), turn(2)])).toEqual(expected);
    expect(replay([turn(2), turn(1), turn(1), turn(3), turn(2), turn(3)])).toEqual(expected);
  });

  it("stops at a hole in the log", () => {
    expect(replay([turn(1), turn(2), turn(4), turn(5)]).turns).toBe(2);
  });
});

describe("toHistory", () => {
  it("is the remembered exchanges as alternating user and assistant text", () => {
    const history = toHistory(replay([turn(1), turn(2)]));
    expect(history.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(history[3]).toEqual({ role: "assistant", content: [{ text: "answer 2" }] });
    expect(toHistory(EMPTY)).toEqual([]);
  });
});
