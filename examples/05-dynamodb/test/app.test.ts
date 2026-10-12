import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { createApp } from "../src/app.ts";
import { ApiError, createNotesClient } from "../src/client.ts";
import {
  errorSchema,
  MAX_NOTES_PER_OWNER,
  MAX_PAGE_SIZE,
  noteListSchema,
  noteSchema,
} from "../src/contract.ts";
import { InMemoryNoteRepository } from "../src/memory-repository.ts";
import { createNoteService } from "../src/notes.ts";

function setup(maxNotesPerOwner?: number) {
  let clock = Date.UTC(2026, 9, 11);
  let suffix = 0;
  let requestId = 0;
  const app = createApp({
    env: {
      ALLOWED_ORIGIN: "http://localhost:5173",
      LOG_LEVEL: "error",
      STAGE: "test",
      NOTES_STORE: "memory",
    },
    notes: createNoteService({
      repository: new InMemoryNoteRepository(maxNotesPerOwner),
      // One second per call, so creation order and ID order agree.
      now: () => new Date((clock += 1000)),
      randomSuffix: () => String(++suffix).padStart(4, "0"),
    }),
    log: () => {},
    newRequestId: () => `req-${++requestId}`,
    now: () => clock,
  });
  // No socket: a Request goes straight into the handler, and a Response comes back.
  const call = (path: string, init?: RequestInit) =>
    Promise.resolve(app(new Request(`http://api.test${path}`, init)));
  const json = (method: string, path: string, body: unknown) =>
    call(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const viaApp: typeof fetch = async (input, init) => app(new Request(input, init));
  return { call, json, client: createNotesClient("http://api.test", viaApp), viaApp };
}

describe("notes API with versions", () => {
  it("creates a note at version 1", async () => {
    const { json } = setup();
    const note = v.parse(
      noteSchema,
      await (await json("POST", "/notes", { title: "first" })).json(),
    );
    expect(note).toMatchObject({ version: 1, title: "first", body: "" });
    expect(note.createdAt).toBe(note.updatedAt);
  });

  it("updates a note when the caller holds the current version", async () => {
    const { json } = setup();
    const created = v.parse(
      noteSchema,
      await (await json("POST", "/notes", { title: "draft" })).json(),
    );
    const response = await json("PUT", `/notes/${created.id}`, {
      title: "final",
      body: "done",
      expectedVersion: 1,
    });
    expect(response.status).toBe(200);
    expect(v.parse(noteSchema, await response.json())).toMatchObject({
      version: 2,
      title: "final",
      createdAt: created.createdAt,
    });
  });

  it("answers 409 with the stored note for a stale version", async () => {
    const { json } = setup();
    const created = v.parse(
      noteSchema,
      await (await json("POST", "/notes", { title: "shared" })).json(),
    );
    await json("PUT", `/notes/${created.id}`, {
      title: "from tab A",
      body: "",
      expectedVersion: 1,
    });

    const response = await json("PUT", `/notes/${created.id}`, {
      title: "from tab B",
      body: "",
      expectedVersion: 1,
    });
    const body = v.parse(errorSchema, await response.json());
    expect(response.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.current).toMatchObject({ version: 2, title: "from tab A" });
  });

  it("answers 409 quota_exceeded for note 101, and takes one again after a delete", async () => {
    const { call, json } = setup(MAX_NOTES_PER_OWNER);
    let first = "";
    for (let count = 1; count <= MAX_NOTES_PER_OWNER; count++) {
      const response = await json("POST", "/notes", { title: `note ${count}` });
      expect(response.status).toBe(201);
      first ||= v.parse(noteSchema, await response.json()).id;
    }

    const full = await json("POST", "/notes", { title: "one too many" });
    expect(full.status).toBe(409);
    expect(v.parse(errorSchema, await full.json()).error.code).toBe("quota_exceeded");

    expect((await call(`/notes/${first}`, { method: "DELETE" })).status).toBe(204);
    expect((await json("POST", "/notes", { title: "fits now" })).status).toBe(201);
  });

  it("requires expectedVersion", async () => {
    const { json } = setup();
    const created = v.parse(
      noteSchema,
      await (await json("POST", "/notes", { title: "x" })).json(),
    );
    const response = await json("PUT", `/notes/${created.id}`, { title: "y", body: "" });
    expect(response.status).toBe(400);
    expect(
      v.parse(errorSchema, await response.json()).error.issues?.map((issue) => issue.path),
    ).toEqual(["expectedVersion"]);
  });

  it("answers 404 for an update to a note that does not exist", async () => {
    const { json } = setup();
    expect(
      (await json("PUT", "/notes/missing", { title: "y", body: "", expectedVersion: 1 })).status,
    ).toBe(404);
  });

  it("pages newest first, every note exactly once", async () => {
    const { call, json } = setup();
    for (const title of ["one", "two", "three", "four", "five"]) {
      await json("POST", "/notes", { title });
    }
    const titles: string[] = [];
    let path = "/notes?limit=2";
    for (let page = 0; page < 10; page++) {
      const list = v.parse(noteListSchema, await (await call(path)).json());
      titles.push(...list.notes.map((note) => note.title));
      if (list.nextCursor === null) {
        break;
      }
      path = `/notes?limit=2&cursor=${encodeURIComponent(list.nextCursor)}`;
    }
    expect(titles).toEqual(["five", "four", "three", "two", "one"]);
  });

  // #region list-bound
  it("lists summaries only: no body, 20 a page, under 20 KiB at the worst", async () => {
    const { call, json } = setup();
    // The largest note the contract takes. A control character is six bytes of JSON.
    const largest = { title: "\u0001".repeat(120), body: "\u0001".repeat(10_000) };
    for (let count = 0; count <= MAX_PAGE_SIZE; count++) {
      expect((await json("POST", "/notes", largest)).status).toBe(201);
    }

    for (const path of ["/notes", `/notes?limit=${MAX_PAGE_SIZE}`]) {
      const text = await (await call(path)).text();
      const list = v.parse(noteListSchema, JSON.parse(text));
      expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(20 * 1024);
      expect(list.notes).toHaveLength(MAX_PAGE_SIZE);
      expect(list.nextCursor).not.toBeNull();
      expect(text).not.toContain('"body"');

      // The whole note is one request away.
      const first = await call(`/notes/${list.notes[0]?.id}`);
      expect(v.parse(noteSchema, await first.json()).body).toHaveLength(10_000);
    }
  });

  it("has a list contract that refuses a body and a page past the maximum", () => {
    const summary = {
      id: "a",
      title: "t",
      version: 1,
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    };
    const parses = (notes: unknown[]) =>
      v.safeParse(noteListSchema, { notes, nextCursor: null }).success;
    expect(parses([summary])).toBe(true);
    expect(parses([{ ...summary, body: "" }])).toBe(false);
    expect(parses(Array.from({ length: MAX_PAGE_SIZE + 1 }, () => summary))).toBe(false);
  });
  // #endregion list-bound

  it("lets the allowed origin read an error the routes threw", async () => {
    const { call } = setup();
    const response = await call("/notes?cursor=..%2F..%2Fetc", {
      headers: { origin: "http://localhost:5173" },
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("x-request-id")).toBe("req-1");
  });

  it("rejects a forged cursor and an out-of-range limit with 400", async () => {
    const { call } = setup();
    for (const path of [
      "/notes?cursor=..%2F..%2Fetc",
      "/notes?limit=0",
      `/notes?limit=${MAX_PAGE_SIZE + 1}`,
    ]) {
      const response = await call(path);
      expect(response.status, path).toBe(400);
      expect(v.parse(errorSchema, await response.json()).error.code).toBe("invalid_request");
    }
  });
});

describe("typed client and the lost response", () => {
  it("returns a real conflict with the other writer's note", async () => {
    const { client } = setup();
    const note = await client.create({ title: "shared", body: "" });
    await client.update(note.id, { title: "theirs", body: "", expectedVersion: 1 });

    const outcome = await client.update(note.id, { title: "mine", body: "", expectedVersion: 1 });
    expect(outcome).toMatchObject({ status: "conflict", current: { title: "theirs", version: 2 } });
  });

  it("recognizes its own write after a lost response", async () => {
    const { viaApp } = setup();
    // The network delivers the first PUT to the server, then loses the answer.
    let dropNextPutResponse = true;
    const flaky: typeof fetch = async (input, init) => {
      const response = await viaApp(input, init);
      if (new Request(input, init).method === "PUT" && dropNextPutResponse) {
        dropNextPutResponse = false;
        throw new TypeError("fetch failed");
      }
      return response;
    };
    const client = createNotesClient("http://api.test", flaky);
    const note = await client.create({ title: "draft", body: "" });
    const change = { title: "final", body: "saved once", expectedVersion: 1 };

    await expect(client.update(note.id, change)).rejects.toThrow("fetch failed");
    // The caller cannot know whether the write happened, so it sends it again.
    const retried = await client.update(note.id, change);

    expect(retried).toMatchObject({ status: "updated", note: { version: 2, title: "final" } });
    // The invariant: one logical save moved the version by one, not by two.
    expect((await client.get(note.id)).version).toBe(2);
  });

  it("makes a second note when a POST is retried", async () => {
    // Recorded on purpose: a POST carries nothing that marks it as a retry.
    // Chapter 08 adds idempotency keys.
    const { viaApp } = setup();
    let dropNextPostResponse = true;
    const flaky: typeof fetch = async (input, init) => {
      const response = await viaApp(input, init);
      if (new Request(input, init).method === "POST" && dropNextPostResponse) {
        dropNextPostResponse = false;
        throw new TypeError("fetch failed");
      }
      return response;
    };
    const client = createNotesClient("http://api.test", flaky);
    await expect(client.create({ title: "once", body: "" })).rejects.toThrow("fetch failed");
    await client.create({ title: "once", body: "" });
    expect((await client.list()).notes.map((note) => note.title)).toEqual(["once", "once"]);
  });

  it("rejects a list that carries bodies, instead of handing them on", async () => {
    const note = {
      id: "a",
      title: "t",
      body: "x".repeat(10_000),
      version: 1,
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    };
    const oldServer: typeof fetch = async () => Response.json({ notes: [note], nextCursor: null });
    await expect(createNotesClient("http://api.test", oldServer).list()).rejects.toMatchObject({
      code: "unexpected_response",
    });
  });

  it("surfaces errors other than conflicts as ApiError", async () => {
    const { client } = setup();
    await expect(
      client.update("missing", { title: "x", body: "", expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
