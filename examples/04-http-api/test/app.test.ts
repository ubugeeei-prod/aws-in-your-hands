import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { createApp } from "../src/app.ts";
import { errorSchema, MAX_LISTED_NOTES, noteListSchema, noteSchema } from "../src/contract.ts";
import type { LogEntry } from "../src/log.ts";
import {
  createNoteService,
  InMemoryNoteRepository,
  MAX_NOTES,
  type NoteRepository,
} from "../src/notes.ts";

// Everything that would make a test depend on when or where it runs is passed
// in: the clock, the ID generators, the repository, and the log sink.
function setup(repository: NoteRepository = new InMemoryNoteRepository()) {
  let noteId = 0;
  let requestId = 0;
  let clock = Date.UTC(2026, 9, 11);
  const logs: LogEntry[] = [];
  const app = createApp({
    env: { ALLOWED_ORIGIN: "http://localhost:5173", LOG_LEVEL: "debug", STAGE: "test" },
    notes: createNoteService({
      repository,
      now: () => new Date((clock += 1000)),
      newId: () => `note-${++noteId}`,
    }),
    log: (entry) => logs.push(entry),
    newRequestId: () => `req-${++requestId}`,
    now: () => (clock += 5),
  });
  // No socket: a Request goes straight into the handler, and a Response comes back.
  const call = (path: string, init?: RequestInit) =>
    Promise.resolve(app(new Request(`http://api.test${path}`, init)));
  const post = (
    body: unknown,
    headers: Record<string, string> = { "content-type": "application/json" },
  ) =>
    call("/notes", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { call, logs, post };
}

describe("notes API", () => {
  it("creates a note and returns it from the list, newest first", async () => {
    const { call, post } = setup();
    expect((await post({ title: "first" })).status).toBe(201);
    const second = v.parse(
      noteSchema,
      await (await post({ title: "second", body: "hello" })).json(),
    );

    const list = v.parse(noteListSchema, await (await call("/notes")).json());
    expect(list.notes.map((note) => note.title)).toEqual(["second", "first"]);
    expect(second).toMatchObject({ id: "note-2", body: "hello" });
  });

  // #region list-bound
  it("lists summaries only: no body, the newest 20, under 20 KiB at the worst", async () => {
    const { call, post } = setup();
    // The largest note the contract takes. A control character is six bytes of JSON.
    const largest = { title: "\u0001".repeat(120), body: "\u0001".repeat(10_000) };
    for (let count = 1; count <= MAX_LISTED_NOTES + 1; count++) {
      expect((await post(largest)).status).toBe(201);
    }

    const text = await (await call("/notes")).text();
    const json: unknown = JSON.parse(text);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(20 * 1024);
    expect(v.parse(noteListSchema, json).notes.map((note) => note.id)).toEqual(
      Array.from(
        { length: MAX_LISTED_NOTES },
        (_, index) => `note-${MAX_LISTED_NOTES + 1 - index}`,
      ),
    );
    expect(text).not.toContain('"body"');

    // The whole note is one request away.
    const whole = v.parse(noteSchema, await (await call("/notes/note-1")).json());
    expect(whole.body).toHaveLength(10_000);
  });

  it("has a list contract that refuses a body and a 21st note", () => {
    const summary = { id: "a", title: "t", createdAt: "2026-10-11T00:00:00.000Z" };
    expect(v.safeParse(noteListSchema, { notes: [summary] }).success).toBe(true);
    expect(v.safeParse(noteListSchema, { notes: [{ ...summary, body: "" }] }).success).toBe(false);
    expect(
      v.safeParse(noteListSchema, {
        notes: Array.from({ length: MAX_LISTED_NOTES + 1 }, () => summary),
      }).success,
    ).toBe(false);
  });
  // #endregion list-bound

  it("rejects a note without a title and says which field is wrong", async () => {
    const { post } = setup();
    const response = await post({ title: "  ", body: "x" });
    const body = v.parse(errorSchema, await response.json());

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.issues?.map((issue) => issue.path)).toEqual(["title"]);
  });

  it("rejects a body that is not JSON with the same error shape", async () => {
    const { post } = setup();
    const response = await post("{not json");
    expect(response.status).toBe(400);
    expect(v.parse(errorSchema, await response.json()).error.code).toBe("invalid_request");
  });

  it("refuses a body over 64 KiB before reading it into a note", async () => {
    const { post } = setup();
    const response = await post({ title: "big", body: "x".repeat(70_000) });
    expect(response.status).toBe(413);
    expect(v.parse(errorSchema, await response.json()).error.code).toBe("payload_too_large");
  });

  it("refuses note 101 with 409 and takes one again after a delete", async () => {
    const { call, post } = setup();
    for (let count = 1; count <= MAX_NOTES; count++) {
      expect((await post({ title: `note ${count}` })).status).toBe(201);
    }

    const full = await post({ title: "one too many" });
    expect(full.status).toBe(409);
    expect(v.parse(errorSchema, await full.json()).error.code).toBe("quota_exceeded");
    expect((await call("/notes/note-1")).status).toBe(200);

    expect((await call("/notes/note-1", { method: "DELETE" })).status).toBe(204);
    expect((await post({ title: "fits now" })).status).toBe(201);
  });

  it("still replaces a note it already holds when full", async () => {
    const repository = new InMemoryNoteRepository(1);
    const note = { id: "a", title: "first", body: "", createdAt: "2026-10-11T00:00:00.000Z" };
    await repository.put(note);
    await repository.put({ ...note, title: "second" });
    expect((await repository.get("a"))?.title).toBe("second");
    await expect(repository.put({ ...note, id: "b" })).rejects.toThrow(/1 notes/);
  });

  it("answers 404 with the error shape for an unknown note and an unknown route", async () => {
    const { call } = setup();
    for (const path of ["/notes/nope", "/nope"]) {
      const response = await call(path);
      expect(response.status).toBe(404);
      expect(v.parse(errorSchema, await response.json()).error.code).toBe("not_found");
    }
  });

  it("deletes a note once; the second delete is a 404", async () => {
    const { call, post } = setup();
    const note = v.parse(noteSchema, await (await post({ title: "temp" })).json());
    expect((await call(`/notes/${note.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/notes/${note.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("puts the same request ID in the response header, the error body, and the log", async () => {
    const { call, logs } = setup();
    const response = await call("/notes/nope");
    const body = v.parse(errorSchema, await response.json());

    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(body.error.requestId).toBe("req-1");
    expect(logs).toContainEqual(
      expect.objectContaining({ requestId: "req-1", path: "/notes/nope", status: 404 }),
    );
  });

  it("hides the cause of an internal failure from the caller and logs it", async () => {
    const broken: NoteRepository = {
      list: () => Promise.reject(new Error("connection reset by table")),
      get: () => Promise.resolve(undefined),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(false),
    };
    const { call, logs } = setup(broken);
    const response = await call("/notes");
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("connection reset");
    expect(v.parse(errorSchema, JSON.parse(text)).error.code).toBe("internal");
    expect(
      logs.some(
        (entry) => entry.level === "error" && String(entry["error"]).includes("connection reset"),
      ),
    ).toBe(true);
  });

  it("allows the configured browser origin and no other", async () => {
    const { call } = setup();
    const allowed = await call("/notes", { headers: { origin: "http://localhost:5173" } });
    const other = await call("/notes", { headers: { origin: "https://example.com" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(other.headers.get("access-control-allow-origin")).not.toBe("https://example.com");
  });

  it("does not share notes between two application instances", async () => {
    // Two instances stand in for two Lambda execution environments. A note
    // written through one is invisible through the other, which is why this
    // repository is a teaching step and not a place to keep data.
    const first = setup();
    const second = setup();
    await first.post({ title: "only here" });
    const list = v.parse(noteListSchema, await (await second.call("/notes")).json());
    expect(list.notes).toEqual([]);
  });
});
