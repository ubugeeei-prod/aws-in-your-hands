import { randomUUID } from "node:crypto";

import * as v from "valibot";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createApp } from "../src/app.ts";
import { errorSchema, MAX_LISTED_NOTES, noteListSchema, noteSchema } from "../src/contract.ts";
import type { Db } from "../src/db.ts";
import type { LogEntry } from "../src/log.ts";
import { SqlNoteRepository } from "../src/notes-repository.ts";
import { createNoteService } from "../src/notes.ts";
import { losingCommits, migratedDb, runnerFor } from "./support.ts";

let db: Db;
beforeAll(async () => {
  // Booting PGlite and migrating can take seconds on a busy machine.
  db = await migratedDb();
}, 60_000);
afterAll(() => db.close());

// The API has one shared owner until chapter 06, so each test empties the tables first.
async function setup(options: { database?: Db; quota?: number } = {}) {
  await db.withConnection(async (connection) => {
    await connection.query("DELETE FROM app.notes");
    await connection.query("DELETE FROM app.owners");
  });
  let clock = Date.UTC(2026, 9, 11);
  let requestId = 0;
  const logs: LogEntry[] = [];
  const app = createApp({
    env: {
      ALLOWED_ORIGIN: "http://localhost:5173",
      LOG_LEVEL: "debug",
      STAGE: "test",
      NOTES_DB: "pglite",
      PGLITE_DATA_DIR: "unused",
    },
    notes: createNoteService({
      repository: new SqlNoteRepository(
        runnerFor(options.database ?? db).transaction,
        options.quota ?? 100,
      ),
      now: () => new Date((clock += 1000)),
      newId: randomUUID,
    }),
    log: (entry) => logs.push(entry),
    newRequestId: () => `req-${++requestId}`,
    now: () => (clock += 5),
  });
  const send = (method: string, path: string, body?: unknown) =>
    app(
      new Request(`http://api.test${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
    );
  return { app, logs, send };
}

describe("notes API on SQL", () => {
  it("creates notes and lists them newest first", async () => {
    const { send } = await setup();
    expect((await send("POST", "/notes", { title: "first" })).status).toBe(201);
    const second = v.parse(
      noteSchema,
      await (await send("POST", "/notes", { title: "second", body: "hello" })).json(),
    );

    const list = v.parse(noteListSchema, await (await send("GET", "/notes")).json());
    expect(list.notes.map((item) => item.title)).toEqual(["second", "first"]);
    expect(v.parse(noteSchema, await (await send("GET", `/notes/${second.id}`)).json())).toEqual(
      second,
    );
  });

  // #region list-bound
  it("lists summaries only: no body, the newest 20, under 20 KiB at the worst", async () => {
    const { send } = await setup();
    // The largest note the contract takes. A control character is six bytes of JSON.
    const largest = { title: "\u0001".repeat(120), body: "\u0001".repeat(10_000) };
    const created = [];
    for (let count = 0; count <= MAX_LISTED_NOTES; count++) {
      created.push(v.parse(noteSchema, await (await send("POST", "/notes", largest)).json()));
    }

    const text = await (await send("GET", "/notes")).text();
    const list = v.parse(noteListSchema, JSON.parse(text));
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(20 * 1024);
    expect(list.notes.map((item) => item.id)).toEqual(
      created
        .slice(1)
        .map((item) => item.id)
        .toReversed(),
    );
    expect(text).not.toContain('"body"');

    // The whole note is one request away.
    const oldest = await send("GET", `/notes/${created[0]?.id}`);
    expect(v.parse(noteSchema, await oldest.json()).body).toHaveLength(10_000);
  });

  it("has a list contract that refuses a body and a 21st note", () => {
    const summary = {
      id: randomUUID(),
      title: "t",
      version: 1,
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    };
    const parses = (notes: unknown[]) => v.safeParse(noteListSchema, { notes }).success;
    expect(parses([summary])).toBe(true);
    expect(parses([{ ...summary, body: "" }])).toBe(false);
    expect(parses(Array.from({ length: MAX_LISTED_NOTES + 1 }, () => summary))).toBe(false);
  });
  // #endregion list-bound

  it("answers 404 for an id that is not a UUID instead of passing it to the database", async () => {
    const { send, logs } = await setup();
    for (const [method, body] of [
      ["GET"],
      ["DELETE"],
      ["PUT", { title: "x", expectedVersion: 1 }],
    ] as const) {
      const response = await send(method, "/notes/not-a-uuid", body);
      expect(response.status).toBe(404);
      expect(v.parse(errorSchema, await response.json()).error.code).toBe("not_found");
    }
    expect(logs.some((entry) => entry.level === "error")).toBe(false);
  });

  it("refuses a stale update with 409 and the note as it is stored", async () => {
    const { send } = await setup();
    const created = v.parse(
      noteSchema,
      await (await send("POST", "/notes", { title: "draft" })).json(),
    );
    expect(
      (await send("PUT", `/notes/${created.id}`, { title: "mine", expectedVersion: 1 })).status,
    ).toBe(200);

    const stale = await send("PUT", `/notes/${created.id}`, {
      title: "theirs",
      expectedVersion: 1,
    });
    const body = v.parse(errorSchema, await stale.json());

    expect(stale.status).toBe(409);
    expect(body.error).toMatchObject({ code: "conflict", current: { title: "mine", version: 2 } });
  });

  it("answers 409 quota_exceeded when the owner is full", async () => {
    const { send } = await setup({ quota: 1 });
    expect((await send("POST", "/notes", { title: "fits" })).status).toBe(201);

    const response = await send("POST", "/notes", { title: "does not" });

    expect(response.status).toBe(409);
    expect(v.parse(errorSchema, await response.json()).error.code).toBe("quota_exceeded");
  });

  it("answers 503 busy with retry-after when the conflicts do not stop, having written nothing", async () => {
    const { send } = await setup({ database: losingCommits(db, { conflicts: 4 }) });

    const response = await send("POST", "/notes", { title: "contended" });

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    // A page on the allowed origin has to be able to read this answer to retry.
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(v.parse(errorSchema, await response.json()).error.code).toBe("busy");
    const list = v.parse(noteListSchema, await (await send("GET", "/notes")).json());
    expect(list.notes).toEqual([]);
  });

  it("hides a database error from the caller and logs it", async () => {
    const broken: Db = {
      withConnection: () => Promise.reject(new Error('relation "app.notes" does not exist')),
      close: () => Promise.resolve(),
    };
    const { send, logs } = await setup({ database: broken });

    const response = await send("GET", "/notes");
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("app.notes");
    expect(v.parse(errorSchema, JSON.parse(text)).error.code).toBe("internal");
    expect(
      logs.some((entry) => entry.level === "error" && String(entry["error"]).includes("app.notes")),
    ).toBe(true);
  });
});
