import { randomUUID } from "node:crypto";

import * as v from "valibot";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { noteSchema } from "@aih/example-13-sql/src/contract.ts";

import { createRoutedApp, READ_FROM_HEADER, SEEN_HEADER } from "../src/app.ts";
import { parseLsn } from "../src/lsn.ts";
import type { ReplicationModel } from "../src/model/replication.ts";
import { migratedModel } from "./support.ts";

let model: ReplicationModel;
beforeAll(async () => {
  model = await migratedModel();
}, 60_000);
afterAll(() => model.close());

const ORIGIN = "http://localhost:5173";

function appWith(replica: boolean) {
  let clock = Date.UTC(2026, 9, 13);
  return createRoutedApp({
    allowedOrigin: ORIGIN,
    stage: "test",
    database: "model",
    primary: model.primary,
    ...(replica ? { replica: { db: model.replica, position: model.position } } : {}),
    log: () => undefined,
    clock: () => new Date((clock += 1000)),
    now: () => clock,
    newId: randomUUID,
    newRequestId: randomUUID,
    sleep: () => Promise.resolve(),
    random: () => 0,
  });
}

const send = (
  app: ReturnType<typeof appWith>,
  method: string,
  path: string,
  options: { body?: unknown; seen?: string | null } = {},
) =>
  app(
    new Request(`http://api.test${path}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.seen ? { [SEEN_HEADER]: options.seen } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  );

describe("the notes API in front of a primary and a lagging replica", () => {
  // #region http
  it("hands the writer a position, and honours it on the next read", async () => {
    const app = appWith(true);
    const created = await send(app, "POST", "/notes", { body: { title: "just written" } });
    expect(created.status).toBe(201);
    const note = v.parse(noteSchema, await created.json());
    const seen = created.headers.get(SEEN_HEADER);
    expect(parseLsn(seen ?? "")).toBeDefined();

    // Without the position, the replica answers, and it has not got the note yet.
    const forgetful = await send(app, "GET", `/notes/${note.id}`);
    expect(forgetful.status).toBe(404);
    expect(forgetful.headers.get(READ_FROM_HEADER)).toBe("replica");

    // With it, the primary answers.
    const read = await send(app, "GET", `/notes/${note.id}`, { seen });
    expect(read.status).toBe(200);
    expect(read.headers.get(READ_FROM_HEADER)).toBe("primary");

    await model.replay();
    const later = await send(app, "GET", `/notes/${note.id}`, { seen });
    expect(later.status).toBe(200);
    expect(later.headers.get(READ_FROM_HEADER)).toBe("replica");
  });
  // #endregion http

  it("sends a position that is not one to the primary", async () => {
    const app = appWith(true);
    const response = await send(app, "GET", "/notes", { seen: "'; DROP TABLE app.notes; --" });
    expect(response.status).toBe(200);
    expect(response.headers.get(READ_FROM_HEADER)).toBe("primary");
  });

  it("lets a page on the allowed origin send the position and read it back", async () => {
    const app = appWith(true);
    const preflight = await send(app, "OPTIONS", "/notes");
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(preflight.headers.get("access-control-allow-headers")).toBe(
      `content-type, ${SEEN_HEADER}`,
    );
    const response = await send(app, "GET", "/notes");
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-expose-headers")).toContain(SEEN_HEADER);
  });

  it("reports the database it runs on, with chapter 13's request ID", async () => {
    const response = await send(appWith(true), "GET", "/health");
    expect(await response.json()).toEqual({
      status: "ok",
      stage: "test",
      db: "model",
      replica: true,
    });
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reads and writes the primary only when there is no replica", async () => {
    const app = appWith(false);
    const created = await send(app, "POST", "/notes", { body: { title: "no replica" } });
    const note = v.parse(noteSchema, await created.json());
    // No position is handed out, because nothing would ever need it.
    expect(created.headers.get(SEEN_HEADER)).toBeNull();

    const read = await send(app, "GET", `/notes/${note.id}`);
    expect(read.status).toBe(200);
    expect(read.headers.get(READ_FROM_HEADER)).toBeNull();
    expect(await (await send(app, "GET", "/health")).json()).toMatchObject({ replica: false });
    await model.replay();
  });
});
