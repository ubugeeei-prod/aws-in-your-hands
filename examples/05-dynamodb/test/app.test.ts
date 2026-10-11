import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { ApiError, createNotesClient } from "../src/client.ts";
import { errorSchema, noteListSchema, noteSchema } from "../src/contract.ts";
import { InMemoryNoteRepository } from "../src/memory-repository.ts";
import { createNoteService } from "../src/notes.ts";

function setup() {
  let clock = Date.UTC(2026, 9, 11);
  let suffix = 0;
  let requestId = 0;
  const app = createApp({
    env: { ALLOWED_ORIGIN: "http://localhost:5173", LOG_LEVEL: "error", STAGE: "test", NOTES_STORE: "memory" },
    notes: createNoteService({
      repository: new InMemoryNoteRepository(),
      // One second per call, so creation order and ID order agree.
      now: () => new Date((clock += 1000)),
      randomSuffix: () => String(++suffix).padStart(4, "0"),
    }),
    log: () => {},
    newRequestId: () => `req-${++requestId}`,
    now: () => clock,
  });
  const json = (method: string, path: string, body: unknown) =>
    app.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const viaApp: typeof fetch = async (input, init) => app.fetch(new Request(input, init));
  return { app, json, client: createNotesClient("http://api.test", viaApp), viaApp };
}

describe("notes API with versions", () => {
  it("creates a note at version 1", async () => {
    const { json } = setup();
    const note = noteSchema.parse(await (await json("POST", "/notes", { title: "first" })).json());
    expect(note).toMatchObject({ version: 1, title: "first", body: "" });
    expect(note.createdAt).toBe(note.updatedAt);
  });

  it("updates a note when the caller holds the current version", async () => {
    const { json } = setup();
    const created = noteSchema.parse(await (await json("POST", "/notes", { title: "draft" })).json());
    const response = await json("PUT", `/notes/${created.id}`, { title: "final", body: "done", expectedVersion: 1 });
    expect(response.status).toBe(200);
    expect(noteSchema.parse(await response.json())).toMatchObject({
      version: 2,
      title: "final",
      createdAt: created.createdAt,
    });
  });

  it("answers 409 with the stored note for a stale version", async () => {
    const { json } = setup();
    const created = noteSchema.parse(await (await json("POST", "/notes", { title: "shared" })).json());
    await json("PUT", `/notes/${created.id}`, { title: "from tab A", body: "", expectedVersion: 1 });

    const response = await json("PUT", `/notes/${created.id}`, { title: "from tab B", body: "", expectedVersion: 1 });
    const body = errorSchema.parse(await response.json());
    expect(response.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.current).toMatchObject({ version: 2, title: "from tab A" });
  });

  it("requires expectedVersion", async () => {
    const { json } = setup();
    const created = noteSchema.parse(await (await json("POST", "/notes", { title: "x" })).json());
    const response = await json("PUT", `/notes/${created.id}`, { title: "y", body: "" });
    expect(response.status).toBe(400);
    expect(errorSchema.parse(await response.json()).error.issues?.map((issue) => issue.path)).toEqual([
      "expectedVersion",
    ]);
  });

  it("answers 404 for an update to a note that does not exist", async () => {
    const { json } = setup();
    expect((await json("PUT", "/notes/missing", { title: "y", body: "", expectedVersion: 1 })).status).toBe(404);
  });

  it("pages newest first, every note exactly once", async () => {
    const { app, json } = setup();
    for (const title of ["one", "two", "three", "four", "five"]) {
      await json("POST", "/notes", { title });
    }
    const titles: string[] = [];
    let path = "/notes?limit=2";
    for (let page = 0; page < 10; page++) {
      const list = noteListSchema.parse(await (await app.request(path)).json());
      titles.push(...list.notes.map((note) => note.title));
      if (list.nextCursor === null) {
        break;
      }
      path = `/notes?limit=2&cursor=${encodeURIComponent(list.nextCursor)}`;
    }
    expect(titles).toEqual(["five", "four", "three", "two", "one"]);
  });

  it("rejects a forged cursor and an out-of-range limit with 400", async () => {
    const { app } = setup();
    for (const path of ["/notes?cursor=..%2F..%2Fetc", "/notes?limit=0", "/notes?limit=1000"]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(400);
      expect(errorSchema.parse(await response.json()).error.code).toBe("invalid_request");
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

  it("surfaces errors other than conflicts as ApiError", async () => {
    const { client } = setup();
    await expect(client.update("missing", { title: "x", body: "", expectedVersion: 1 })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
