import { InMemoryNoteRepository } from "@aih/example-05-dynamodb/src/memory-repository.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";
import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { ApiError, createNotesClient } from "../src/client.ts";
import { errorSchema } from "../src/contract.ts";
import { createLocalAuthenticator, signLocalToken } from "../src/local-auth.ts";

const secret = "test-secret-that-is-at-least-32-chars";

async function setup() {
  let clock = Date.UTC(2026, 9, 11);
  let suffix = 0;
  const logs: Record<string, unknown>[] = [];
  const app = createApp({
    env: { ALLOWED_ORIGIN: "http://localhost:5173", LOG_LEVEL: "debug", STAGE: "test", NOTES_STORE: "memory" },
    notes: createNoteService({
      repository: new InMemoryNoteRepository(),
      now: () => new Date((clock += 1000)),
      randomSuffix: () => String(++suffix).padStart(4, "0"),
    }),
    authenticate: createLocalAuthenticator(secret),
    log: (entry) => logs.push(entry),
    newRequestId: () => "req-1",
    now: () => clock,
  });
  const viaApp: typeof fetch = async (input, init) => app.fetch(new Request(input, init));
  const tokens = { alice: await signLocalToken(secret, "alice"), bob: await signLocalToken(secret, "bob") };
  const as = (token: string | undefined) => createNotesClient("http://api.test", () => token, viaApp);
  return { app, logs, tokens, alice: as(tokens.alice), bob: as(tokens.bob), anonymous: as(undefined) };
}

const rejection = async (promise: Promise<unknown>) => {
  const error = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) {
    throw new Error("expected the request to be rejected");
  }
  return error;
};

describe("authentication", () => {
  it("answers 401 without a token, on every route", async () => {
    const { app } = await setup();
    for (const [method, path] of [
      ["GET", "/notes"],
      ["POST", "/notes"],
      ["GET", "/notes/x"],
      ["PUT", "/notes/x"],
      ["DELETE", "/notes/x"],
      ["GET", "/me"],
    ] as const) {
      const response = await app.request(path, { method });
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(errorSchema.parse(await response.json()).error.code).toBe("unauthenticated");
    }
  });

  it("answers 401 to a token that does not verify", async () => {
    const { app } = await setup();
    const response = await app.request("/notes", { headers: { authorization: "Bearer not.a.token" } });
    expect(response.status).toBe(401);
  });

  it("leaves the health check open", async () => {
    const { anonymous } = await setup();
    expect(await anonymous.health()).toEqual({ status: "ok", stage: "test" });
  });

  it("returns the caller's sub from /me", async () => {
    const { alice } = await setup();
    expect(await alice.me()).toEqual({ sub: "alice" });
  });
});

describe("authorization: own notes only", () => {
  it("lists only the caller's notes", async () => {
    const { alice, bob } = await setup();
    await alice.create({ title: "alice's", body: "" });
    expect((await bob.list()).notes).toEqual([]);
    expect((await alice.list()).notes).toHaveLength(1);
  });

  it("answers 404, not 403, for another user's note", async () => {
    const { alice, bob } = await setup();
    const note = await alice.create({ title: "private", body: "secret" });
    const error = await rejection(bob.get(note.id));
    // Same answer as a missing ID, so Bob learns nothing.
    expect(error).toMatchObject({ status: 404, code: "not_found" });
    expect(await rejection(bob.get("no-such-note"))).toMatchObject({ status: 404, code: "not_found" });
  });

  it("cannot update or delete another user's note", async () => {
    const { alice, bob } = await setup();
    const note = await alice.create({ title: "private", body: "original" });

    expect(await rejection(bob.update(note.id, { title: "defaced", body: "", expectedVersion: 1 }))).toMatchObject({
      status: 404,
    });
    expect(await rejection(bob.remove(note.id))).toMatchObject({ status: 404 });
    expect(await alice.get(note.id)).toMatchObject({ title: "private", body: "original", version: 1 });
  });

  it("takes the owner from the token only", async () => {
    const { app, tokens, alice, bob } = await setup();
    // Bob names Alice everywhere a request can.
    const response = await app.request("/notes?owner=alice&sub=alice", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.bob}`, "x-owner": "alice" },
      body: JSON.stringify({ title: "planted", body: "", owner: "alice", sub: "alice" }),
    });
    expect(response.status).toBe(201);
    expect((await alice.list()).notes).toEqual([]);
    expect((await bob.list()).notes.map((note) => note.title)).toEqual(["planted"]);
  });

  it("still conflicts between two tabs of one user", async () => {
    const { alice } = await setup();
    const note = await alice.create({ title: "draft", body: "" });
    await alice.update(note.id, { title: "tab A", body: "", expectedVersion: 1 });
    expect(await alice.update(note.id, { title: "tab B", body: "", expectedVersion: 1 })).toMatchObject({
      status: "conflict",
    });
  });
});

describe("audit trail", () => {
  it("logs the sub, never the token", async () => {
    const { logs, tokens, alice } = await setup();
    await alice.list();
    expect(logs).toContainEqual(expect.objectContaining({ path: "/notes", status: 200, sub: "alice" }));
    expect(JSON.stringify(logs)).not.toContain(tokens.alice);
  });

  it("logs no sub for a rejected request", async () => {
    const { logs, anonymous } = await setup();
    await rejection(anonymous.list());
    expect(logs).toContainEqual(expect.objectContaining({ path: "/notes", status: 401 }));
    expect(logs.every((entry) => entry["sub"] === undefined)).toBe(true);
  });
});
