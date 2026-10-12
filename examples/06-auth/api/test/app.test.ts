import { describe, expect, it } from "vite-plus/test";

import { InMemoryNoteRepository } from "@aih/example-05-dynamodb/src/memory-repository.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";

import { createApp } from "../src/app.ts";
import { ApiError, createNotesClient } from "../src/client.ts";
import { errorSchema, MAX_NOTES_PER_OWNER, MAX_PAGE_SIZE } from "../src/contract.ts";
import { createLocalAuthenticator, signLocalToken } from "../src/local-auth.ts";

const secret = "test-secret-that-is-at-least-32-chars";

async function setup() {
  let clock = Date.UTC(2026, 9, 11);
  let suffix = 0;
  const logs: Record<string, unknown>[] = [];
  const app = createApp({
    env: {
      ALLOWED_ORIGIN: "http://localhost:5173",
      LOG_LEVEL: "debug",
      STAGE: "test",
      NOTES_STORE: "memory",
    },
    notes: createNoteService({
      repository: new InMemoryNoteRepository(MAX_NOTES_PER_OWNER),
      now: () => new Date((clock += 1000)),
      randomSuffix: () => String(++suffix).padStart(4, "0"),
    }),
    authenticate: createLocalAuthenticator(secret),
    log: (entry) => logs.push(entry),
    newRequestId: () => "req-1",
    now: () => clock,
  });
  const viaApp: typeof fetch = async (input, init) => app.fetch(new Request(input, init));
  const tokens = {
    alice: await signLocalToken(secret, "alice"),
    bob: await signLocalToken(secret, "bob"),
  };
  const as = (token: string | undefined) =>
    createNotesClient("http://api.test", () => token, viaApp);
  return {
    app,
    logs,
    tokens,
    alice: as(tokens.alice),
    bob: as(tokens.bob),
    anonymous: as(undefined),
  };
}

const rejection = async (promise: Promise<unknown>) => {
  const error = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) {
    throw new Error("expected the request to be rejected");
  }
  return error;
};

type Client = Awaited<ReturnType<typeof setup>>["alice"];

// A page holds at most MAX_PAGE_SIZE notes, so counting them all means following the cursor.
const listAll = async (client: Client) => {
  const notes = [];
  let cursor: string | undefined;
  do {
    const page = await client.list(cursor === undefined ? {} : { cursor });
    notes.push(...page.notes);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return notes;
};

describe("how many notes one user may hold", () => {
  const fill = async (client: Awaited<ReturnType<typeof setup>>["alice"]) => {
    const notes = [];
    for (let count = 0; count < MAX_NOTES_PER_OWNER; count++) {
      notes.push(await client.create({ title: `note ${count}`, body: "" }));
    }
    return notes;
  };

  it("refuses the note past the limit with 409, and stores nothing", async () => {
    const { alice } = await setup();
    await fill(alice);
    expect(await rejection(alice.create({ title: "one too many", body: "" }))).toMatchObject({
      status: 409,
      code: "quota_exceeded",
    });
    expect(await listAll(alice)).toHaveLength(MAX_NOTES_PER_OWNER);
  });

  it("counts each user separately: one full account does not close the others", async () => {
    const { alice, bob } = await setup();
    await fill(alice);
    expect((await bob.create({ title: "bob's first", body: "" })).version).toBe(1);
    expect(await rejection(alice.create({ title: "still full", body: "" }))).toMatchObject({
      status: 409,
    });
  });

  it("gives the place back when a note is deleted, and never for an update", async () => {
    const { alice } = await setup();
    const [first] = await fill(alice);
    if (first === undefined) {
      throw new Error("expected a note");
    }
    // Updating a note is not a way around the limit, and is not blocked by it either.
    expect(
      await alice.update(first.id, { title: "edited", body: "", expectedVersion: 1 }),
    ).toMatchObject({ status: "updated" });
    expect(await rejection(alice.create({ title: "no room", body: "" }))).toMatchObject({
      status: 409,
    });
    await alice.remove(first.id);
    expect((await alice.create({ title: "room again", body: "" })).title).toBe("room again");
  });
});

describe("how much one list response may carry", () => {
  it("lists summaries only: no body, 20 a page, under 20 KiB at the worst", async () => {
    const { app, alice, tokens } = await setup();
    // The largest note the contract takes. A control character is six bytes of JSON.
    const largest = { title: "\u0001".repeat(120), body: "\u0001".repeat(10_000) };
    for (let count = 0; count <= MAX_PAGE_SIZE; count++) {
      await alice.create(largest);
    }

    const response = await app.request("/notes", {
      headers: { authorization: `Bearer ${tokens.alice}` },
    });
    const text = await response.text();
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(20 * 1024);
    expect(text).not.toContain('"body"');

    // The client checks the same thing: its schema refuses a body or a 21st note.
    const page = await alice.list();
    expect(page.notes).toHaveLength(MAX_PAGE_SIZE);
    expect(page.nextCursor).not.toBeNull();
    expect(await rejection(alice.list({ limit: MAX_PAGE_SIZE + 1 }))).toMatchObject({
      status: 400,
    });
    expect((await alice.get(page.notes[0]?.id ?? "")).body).toHaveLength(10_000);
  });
});

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
    const response = await app.request("/notes", {
      headers: { authorization: "Bearer not.a.token" },
    });
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
    expect(await rejection(bob.get("no-such-note"))).toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("cannot update or delete another user's note", async () => {
    const { alice, bob } = await setup();
    const note = await alice.create({ title: "private", body: "original" });

    expect(
      await rejection(bob.update(note.id, { title: "defaced", body: "", expectedVersion: 1 })),
    ).toMatchObject({
      status: 404,
    });
    expect(await rejection(bob.remove(note.id))).toMatchObject({ status: 404 });
    expect(await alice.get(note.id)).toMatchObject({
      title: "private",
      body: "original",
      version: 1,
    });
  });

  it("takes the owner from the token only", async () => {
    const { app, tokens, alice, bob } = await setup();
    // Bob names Alice everywhere a request can.
    const response = await app.request("/notes?owner=alice&sub=alice", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokens.bob}`,
        "x-owner": "alice",
      },
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
    expect(
      await alice.update(note.id, { title: "tab B", body: "", expectedVersion: 1 }),
    ).toMatchObject({
      status: "conflict",
    });
  });
});

describe("audit trail", () => {
  it("logs the sub, never the token", async () => {
    const { logs, tokens, alice } = await setup();
    await alice.list();
    expect(logs).toContainEqual(
      expect.objectContaining({ path: "/notes", status: 200, sub: "alice" }),
    );
    expect(JSON.stringify(logs)).not.toContain(tokens.alice);
  });

  it("logs no sub for a rejected request", async () => {
    const { logs, anonymous } = await setup();
    await rejection(anonymous.list());
    expect(logs).toContainEqual(expect.objectContaining({ path: "/notes", status: 401 }));
    expect(logs.every((entry) => entry["sub"] === undefined)).toBe(true);
  });
});
