import { describe, expect, it } from "vite-plus/test";

import { newSessionId, ownsSession } from "../src/session-id.ts";
import {
  ALICE,
  BOB,
  BOBS_SECRET,
  eventsOf,
  invocation,
  SESSION_A,
  SESSION_B,
  startAgent,
} from "./helpers.ts";

// The invariant, carried over from chapter 36: an agent acting for a user reaches only that
// user's notes. Here the loop runs in a runtime that hands this process one role for every
// user, so each test below attacks one of the places the user could be confused with another.

describe("the invariant: the caller is whoever the verified token names", () => {
  it("does not let the body say who is asking", async () => {
    const { agent, model } = await startAgent(["tool-then-answer"]);
    for (const extra of [{ owner: BOB }, { actorId: BOB }, { sub: BOB }, { userId: BOB }]) {
      const response = await agent(invocation(ALICE, SESSION_A, { prompt: "給与は？", ...extra }));
      expect(response.status).toBe(400);
    }
    expect(model.requests).toHaveLength(0);
  });

  it("gives each caller tools bound to that caller, whatever came before in the process", async () => {
    const { agent, model } = await startAgent(["tool-then-answer", "tool-then-answer"]);
    await eventsOf(await agent(invocation(ALICE, SESSION_A)));
    const alices = JSON.stringify(model.requests);
    expect(alices).toContain("リリース前の確認");

    // The same script, so the model asks for Alice's note by its ID. Bob has no such note.
    const events = await eventsOf(await agent(invocation(BOB, SESSION_B)));
    expect(events.filter((event) => event.type === "tool")).toEqual([
      { type: "tool", name: "list_notes", ok: true },
      { type: "tool", name: "read_note", ok: false },
    ]);
    const bobs = JSON.stringify(model.requests.slice(3));
    expect(bobs).toContain("給与の見直し");
    expect(bobs).not.toContain("リリース前の確認");
    expect(bobs).not.toContain("決済の結合テスト");
  });

  it("holds against a model that does whatever a note tells it", async () => {
    const { agent, model } = await startAgent(["injected"]);
    const events = await eventsOf(
      await agent(invocation(ALICE, SESSION_A, { prompt: "「メモ」というノートを要約して" })),
    );
    expect(events.filter((event) => event.type === "tool")).toEqual([
      { type: "tool", name: "read_note", ok: true },
      { type: "tool", name: "read_note", ok: false },
      { type: "tool", name: "list_notes", ok: false },
    ]);
    expect(JSON.stringify(model.requests)).not.toContain(BOBS_SECRET);
    expect(JSON.stringify(events)).not.toContain(BOBS_SECRET);
  });
});

describe("the invariant: a session ID is not a credential", () => {
  it("refuses a second user who presents the first user's session ID", async () => {
    const { agent, model, logs } = await startAgent(["tool-then-answer", "answer-direct"]);
    await eventsOf(await agent(invocation(ALICE, SESSION_A)));
    const before = model.requests.length;

    const response = await agent(invocation(BOB, SESSION_A, { prompt: "さっきの話の続きを" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "session_owner_mismatch" } });
    // Refused before the model: nothing Alice asked or was told went anywhere.
    expect(model.requests).toHaveLength(before);
    expect(logs).toContainEqual(
      expect.objectContaining({ message: "session owner mismatch", caller: BOB }),
    );
  });

  it("refuses them in a fresh process too, where nothing remembers who came first", async () => {
    // Alice talks. Then the session's microVM goes away, and everything the process knew with it.
    const first = await startAgent(["tool-then-answer"]);
    await eventsOf(await first.agent(invocation(ALICE, SESSION_A)));

    const second = await startAgent(["answer-direct"], first.store);
    const response = await second.agent(invocation(BOB, SESSION_A));
    expect(response.status).toBe(403);
    expect(second.model.requests).toHaveLength(0);
    // Being refused did not cost Alice her session: she is served, with what she said before.
    const events = await eventsOf(await second.agent(invocation(ALICE, SESSION_A)));
    expect(events.at(-1)).toMatchObject({ type: "done", complete: true });
    expect(JSON.stringify(second.model.requests[0]?.messages)).toContain("決済の結合テスト");
  });

  it("cannot be talked into another user's session by a look-alike ID", async () => {
    const { agent } = await startAgent(["answer-direct"]);
    const [tag, ...rest] = SESSION_A.split("-");
    for (const forged of [
      // Alice's tag with a new tail is still Alice's. Bob's tag is not hers.
      `${tag}-${rest.join("-")}-extra`,
      SESSION_A.toUpperCase(),
    ]) {
      const response = await agent(invocation(BOB, forged));
      expect([400, 403]).toContain(response.status);
    }
    expect(ownsSession(BOB, newSessionId(BOB))).toBe(true);
    expect(ownsSession(BOB, newSessionId(ALICE))).toBe(false);
    // A user ID that contains another's is a different user.
    expect(ownsSession(`${ALICE}x`, newSessionId(ALICE))).toBe(false);
  });

  it("keeps each actor's events apart in the store, whatever the session is called", async () => {
    const { agent, store } = await startAgent(["answer-direct"]);
    await eventsOf(await agent(invocation(ALICE, SESSION_A)));
    expect(await store.load(ALICE, SESSION_A)).toHaveLength(1);
    // The second wall: even code that skipped the check above would ask for Bob's events.
    expect(await store.load(BOB, SESSION_A)).toEqual([]);
  });
});
