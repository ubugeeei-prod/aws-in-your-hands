import { describe, expect, it } from "vite-plus/test";

import { InMemoryMemoryStore, type MemoryStore } from "../src/memory-store.ts";
import { ALICE, eventsOf, invocation, SESSION_A, startAgent } from "./helpers.ts";

const FIRST = "金曜までに何が残っている？";
const SECOND = "それを一文にまとめて";

describe("what a session remembers", () => {
  it("puts the earlier exchange in front of the next question", async () => {
    const { agent, model } = await startAgent(["tool-then-answer", "answer-direct"]);
    const first = await eventsOf(await agent(invocation(ALICE, SESSION_A, { prompt: FIRST })));
    expect(first.at(-1)).toMatchObject({ type: "done", complete: true });
    expect(model.requests[0]?.messages).toEqual([{ role: "user", content: [{ text: FIRST }] }]);

    await eventsOf(await agent(invocation(ALICE, SESSION_A, { prompt: SECOND })));
    const messages = model.requests[3]?.messages ?? [];
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[0]).toEqual({ role: "user", content: [{ text: FIRST }] });
    expect(JSON.stringify(messages[1])).toContain("決済の結合テスト");
    expect(messages[2]).toEqual({ role: "user", content: [{ text: SECOND }] });
  });

  it("remembers what was said, not what the tools returned", async () => {
    const { agent, model, store } = await startAgent(["tool-then-answer", "answer-direct"]);
    await eventsOf(await agent(invocation(ALICE, SESSION_A, { prompt: FIRST })));
    await eventsOf(await agent(invocation(ALICE, SESSION_A, { prompt: SECOND })));
    // The first question's calls carried tool requests and results. The second's history has none.
    expect(JSON.stringify(model.requests[2]?.messages)).toContain("toolResult");
    expect(JSON.stringify(model.requests[3]?.messages)).not.toContain("toolResult");
    expect(JSON.stringify(model.requests[3]?.messages)).not.toContain("toolUse");
    // The note's own words (its title) are not in the log either. The answer's words are.
    const stored = JSON.stringify(await store.load(ALICE, SESSION_A));
    expect(stored).not.toContain("リリース前の確認");
    expect(stored).toContain("決済の結合テスト");
  });

  it("does not remember an answer that was cut short", async () => {
    const { agent, model, store } = await startAgent(["cut-mid-answer", "answer-direct"]);
    const first = await eventsOf(await agent(invocation(ALICE, SESSION_A, { prompt: FIRST })));
    expect(first.at(-1)).toMatchObject({ type: "error", code: "interrupted" });
    expect(await store.load(ALICE, SESSION_A)).toEqual([]);

    await eventsOf(await agent(invocation(ALICE, SESSION_A, { prompt: SECOND })));
    expect(model.requests.at(-1)?.messages).toEqual([
      { role: "user", content: [{ text: SECOND }] },
    ]);
  });

  it("does not remember a question the model was never able to answer", async () => {
    const { agent, store } = await startAgent(["always-throttled"]);
    const events = await eventsOf(await agent(invocation(ALICE, SESSION_A)));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "throttled" });
    expect(await store.load(ALICE, SESSION_A)).toEqual([]);
  });
});

describe("the invariant: the process remembers exactly what the store accepted", () => {
  it("rebuilds the session from the store when the process is replaced", async () => {
    const first = await startAgent(["tool-then-answer"]);
    await eventsOf(await first.agent(invocation(ALICE, SESSION_A, { prompt: FIRST })));

    // A new process, as after the idle timeout: an empty Map, and the same store.
    const second = await startAgent(["answer-direct"], first.store);
    await eventsOf(await second.agent(invocation(ALICE, SESSION_A, { prompt: SECOND })));
    const messages = second.model.requests[0]?.messages ?? [];
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: "user", content: [{ text: FIRST }] });
    expect((await second.store.load(ALICE, SESSION_A)).map((event) => event.seq)).toEqual([1, 2]);
  });

  it("still answers when the store refuses the write, and then does not pretend to remember", async () => {
    const inner = new InMemoryMemoryStore();
    let failing = true;
    const flaky: MemoryStore = {
      load: (actor, session) => inner.load(actor, session),
      append: (actor, session, event) =>
        failing
          ? Promise.reject(new Error("ThrottledException"))
          : inner.append(actor, session, event),
    };
    const { agent, model, logs } = await startAgent(["answer-direct", "answer-direct"], flaky);

    const first = await eventsOf(await agent(invocation(ALICE, SESSION_A, { prompt: FIRST })));
    expect(first.at(-1)).toMatchObject({ type: "done", complete: true });
    expect(logs).toContainEqual(expect.objectContaining({ message: "turn not remembered" }));
    expect(logs).toContainEqual(
      expect.objectContaining({ message: "invocation", remembered: false }),
    );

    failing = false;
    await eventsOf(await agent(invocation(ALICE, SESSION_A, { prompt: SECOND })));
    // Nothing of the first exchange: the process did not keep what the store did not.
    expect(model.requests[1]?.messages).toEqual([{ role: "user", content: [{ text: SECOND }] }]);
    expect((await inner.load(ALICE, SESSION_A)).map((event) => event.seq)).toEqual([1]);
  });

  it("stores an exchange once when the same write arrives twice", async () => {
    const store = new InMemoryMemoryStore();
    const event = { type: "turn", seq: 1, question: FIRST, answer: "はい。" } as const;
    await store.append(ALICE, SESSION_A, event);
    await store.append(ALICE, SESSION_A, { ...event, answer: "二度目。" });
    expect(await store.load(ALICE, SESSION_A)).toEqual([event]);
  });

  it("keeps the store and the process in step when two answers finish together", async () => {
    const { agent, store } = await startAgent(["answer-direct", "answer-direct"]);
    const [a, b] = await Promise.all([
      agent(invocation(ALICE, SESSION_A, { prompt: FIRST })),
      agent(invocation(ALICE, SESSION_A, { prompt: SECOND })),
    ]);
    await Promise.all([eventsOf(a), eventsOf(b)]);
    const seqs = (await store.load(ALICE, SESSION_A)).map((event) => event.seq).toSorted();
    // Whichever finished second took the next number. Neither overwrote the other.
    expect(seqs).toEqual([1, 2]);
  });
});
