import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createApp } from "../src/app.ts";
import { errorSchema, noteListSchema, noteSchema } from "../src/contract.ts";
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
    app.request(path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  return { app, logs, send };
}

describe("notes API on SQL", () => {
  it("creates notes and lists them newest first", async () => {
    const { send } = await setup();
    expect((await send("POST", "/notes", { title: "first" })).status).toBe(201);
    const second = noteSchema.parse(
      await (await send("POST", "/notes", { title: "second", body: "hello" })).json(),
    );

    const list = noteListSchema.parse(await (await send("GET", "/notes")).json());
    expect(list.notes.map((item) => item.title)).toEqual(["second", "first"]);
    expect(noteSchema.parse(await (await send("GET", `/notes/${second.id}`)).json())).toEqual(
      second,
    );
  });

  it("answers 404 for an id that is not a UUID instead of passing it to the database", async () => {
    const { send, logs } = await setup();
    for (const [method, body] of [
      ["GET"],
      ["DELETE"],
      ["PUT", { title: "x", expectedVersion: 1 }],
    ] as const) {
      const response = await send(method, "/notes/not-a-uuid", body);
      expect(response.status).toBe(404);
      expect(errorSchema.parse(await response.json()).error.code).toBe("not_found");
    }
    expect(logs.some((entry) => entry.level === "error")).toBe(false);
  });

  it("refuses a stale update with 409 and the note as it is stored", async () => {
    const { send } = await setup();
    const created = noteSchema.parse(
      await (await send("POST", "/notes", { title: "draft" })).json(),
    );
    expect(
      (await send("PUT", `/notes/${created.id}`, { title: "mine", expectedVersion: 1 })).status,
    ).toBe(200);

    const stale = await send("PUT", `/notes/${created.id}`, {
      title: "theirs",
      expectedVersion: 1,
    });
    const body = errorSchema.parse(await stale.json());

    expect(stale.status).toBe(409);
    expect(body.error).toMatchObject({ code: "conflict", current: { title: "mine", version: 2 } });
  });

  it("answers 409 quota_exceeded when the owner is full", async () => {
    const { send } = await setup({ quota: 1 });
    expect((await send("POST", "/notes", { title: "fits" })).status).toBe(201);

    const response = await send("POST", "/notes", { title: "does not" });

    expect(response.status).toBe(409);
    expect(errorSchema.parse(await response.json()).error.code).toBe("quota_exceeded");
  });

  it("answers 503 busy with retry-after when the conflicts do not stop, having written nothing", async () => {
    const { send } = await setup({ database: losingCommits(db, { conflicts: 4 }) });

    const response = await send("POST", "/notes", { title: "contended" });

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(errorSchema.parse(await response.json()).error.code).toBe("busy");
    const list = noteListSchema.parse(await (await send("GET", "/notes")).json());
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
    expect(errorSchema.parse(JSON.parse(text)).error.code).toBe("internal");
    expect(
      logs.some((entry) => entry.level === "error" && String(entry["error"]).includes("app.notes")),
    ).toBe(true);
  });
});
