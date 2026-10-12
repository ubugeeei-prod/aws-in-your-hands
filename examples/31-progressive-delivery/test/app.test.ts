import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { createApp } from "@aih/example-04-http-api/src/app.ts";
import { errorSchema, healthSchema } from "@aih/example-04-http-api/src/contract.ts";
import { createNoteService, InMemoryNoteRepository } from "@aih/example-04-http-api/src/notes.ts";

import { createRolloutApp } from "../src/app.ts";
import { composeRollout } from "../src/compose.ts";
import { type Flags, flagsSchema, inRollout } from "../src/flags/evaluate.ts";
import type { FlagOrigin } from "../src/flags/reader.ts";

const ORIGIN = "http://localhost:5173";

function app(
  options: { flags?: unknown; origin?: FlagOrigin; faultPercent?: number; random?: number } = {},
) {
  const repository = new InMemoryNoteRepository();
  let next = 0;
  const state: { flags: Flags } = { flags: v.parse(flagsSchema, options.flags ?? {}) };
  const fetchApp = createRolloutApp({
    inner: createApp({
      env: { ALLOWED_ORIGIN: ORIGIN, LOG_LEVEL: "error", STAGE: "test" },
      log: () => {},
      notes: createNoteService({
        repository,
        now: () => new Date("2026-10-12T00:00:00.000Z"),
        newId: () => `note-${(next += 1)}`,
      }),
      newRequestId: () => "inner-request",
      now: () => 0,
    }),
    readFlags: async () => ({ flags: state.flags, origin: options.origin ?? "live" }),
    countNotes: async () => (await repository.list()).length,
    version: "7",
    allowedOrigin: ORIGIN,
    faultPercent: options.faultPercent ?? 0,
    random: () => options.random ?? 0.5,
    newRequestId: () => "outer-request",
  });
  const call = (
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ) =>
    fetchApp(
      new Request(`http://api.test${path}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
      }),
    );
  return { call, state };
}

describe("every answer", () => {
  it("says which version gave it and where its flags came from", async () => {
    const response = await app({ origin: "last-known" }).call("GET", "/health");
    expect(response.status).toBe(200);
    expect(v.parse(healthSchema, await response.json()).status).toBe("ok");
    expect(response.headers.get("x-app-version")).toBe("7");
    expect(response.headers.get("x-flags-origin")).toBe("last-known");
  });
});

describe("the readOnly flag", () => {
  it("answers writes with 503 in the error shape, readable by the page that sent them", async () => {
    const { call } = app({ flags: { readOnly: { enabled: true } } });
    for (const [method, path] of [
      ["POST", "/notes"],
      ["DELETE", "/notes/note-1"],
    ] as const) {
      const response = await call(method, path, {}, { title: "x" });
      expect(response.status).toBe(503);
      const body = v.parse(
        v.object({ error: v.object({ code: v.string(), requestId: v.string() }) }),
        await response.json(),
      );
      expect(body.error).toEqual({ code: "read_only", requestId: "outer-request" });
      expect(response.headers.get("x-request-id")).toBe("outer-request");
      expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    }
  });

  it("leaves reads alone, and writes too once it is off again", async () => {
    const { call, state } = app({ flags: { readOnly: { enabled: true } } });
    expect((await call("GET", "/notes")).status).toBe(200);
    expect((await call("GET", "/health")).status).toBe(200);
    state.flags = v.parse(flagsSchema, {});
    expect((await call("POST", "/notes", {}, { title: "back" })).status).toBe(201);
  });
});

describe("the noteStats flag", () => {
  const inside = Array.from({ length: 100 }, (_, index) => `user-${index}`).find((subject) =>
    inRollout("noteStats", 10, subject),
  );
  const outside = Array.from({ length: 100 }, (_, index) => `user-${index}`).find(
    (subject) => !inRollout("noteStats", 10, subject),
  );

  it("is a route that does not exist while the flag is off", async () => {
    const response = await app().call("GET", "/stats", { "x-client-id": "user-1" });
    expect(response.status).toBe(404);
    // Chapter 04's own 404, from chapter 04's own code.
    expect(v.parse(errorSchema, await response.json()).error).toMatchObject({
      code: "not_found",
      requestId: "inner-request",
    });
  });

  it("counts the notes for everyone at 100%", async () => {
    const { call } = app({ flags: { noteStats: { enabled: true, rolloutPercent: 100 } } });
    await call("POST", "/notes", {}, { title: "one" });
    await call("POST", "/notes", {}, { title: "two" });
    const response = await call("GET", "/stats");
    expect([response.status, await response.json()]).toEqual([200, { notes: 2 }]);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("at 10% exists for a caller inside the rollout and not for one outside or without an ID", async () => {
    const { call } = app({ flags: { noteStats: { enabled: true, rolloutPercent: 10 } } });
    expect((await call("GET", "/stats", { "x-client-id": inside ?? "" })).status).toBe(200);
    expect((await call("GET", "/stats", { "x-client-id": outside ?? "" })).status).toBe(404);
    expect((await call("GET", "/stats")).status).toBe(404);
  });

  it("answers GET only", async () => {
    const { call } = app({ flags: { noteStats: { enabled: true, rolloutPercent: 100 } } });
    expect((await call("POST", "/stats", {}, {})).status).toBe(404);
  });
});

describe("the fault switch of a practice build", () => {
  it("fails the share of requests it was told to, as a 500 in the error shape", async () => {
    const failing = await app({ faultPercent: 50, random: 0.49 }).call("GET", "/health");
    expect(failing.status).toBe(500);
    expect(v.parse(errorSchema, await failing.json()).error.code).toBe("internal");
    expect(failing.headers.get("x-app-version")).toBe("7");
    expect((await app({ faultPercent: 50, random: 0.5 }).call("GET", "/health")).status).toBe(200);
    expect((await app({ faultPercent: 0, random: 0 }).call("GET", "/health")).status).toBe(200);
  });
});

describe("the composed application when AppConfig cannot be reached", () => {
  const env = {
    ALLOWED_ORIGIN: ORIGIN,
    LOG_LEVEL: "error",
    FLAGS_APPLICATION: "abc1234",
    FLAGS_ENVIRONMENT: "dev",
    FLAGS_PROFILE: "flags",
    AWS_LAMBDA_FUNCTION_VERSION: "12",
  };

  it("serves on the defaults from a cold start, and says so", async () => {
    const composed = composeRollout(env, async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:2772");
    });
    const created = await composed(
      new Request("http://api.test/notes", {
        method: "POST",
        body: JSON.stringify({ title: "t" }),
      }),
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("x-flags-origin")).toBe("defaults");
    expect(created.headers.get("x-app-version")).toBe("12");
    expect((await composed(new Request("http://api.test/stats"))).status).toBe(404);
  });

  it("stays read-only through an outage that begins after the switch was read", async () => {
    let reachable = true;
    const composed = composeRollout(env, async () => {
      if (!reachable) {
        throw new Error("timeout");
      }
      return Response.json({ readOnly: { enabled: true } });
    });
    const write = () =>
      composed(
        new Request("http://api.test/notes", {
          method: "POST",
          body: JSON.stringify({ title: "t" }),
        }),
      );
    expect((await write()).status).toBe(503);
    reachable = false;
    const during = await write();
    expect([during.status, during.headers.get("x-flags-origin")]).toEqual([503, "last-known"]);
  });

  it("refuses to start without being told where its flags are", () => {
    expect(() => composeRollout({ ALLOWED_ORIGIN: ORIGIN })).toThrow("Set FLAGS_FILE");
    expect(() => composeRollout({ ...env, FAULT_PERCENT: "101" })).toThrow("FAULT_PERCENT");
  });
});
