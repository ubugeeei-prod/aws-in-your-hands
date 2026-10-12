import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import type { LogEntry } from "@aih/example-04-http-api/src/log.ts";

import { createApp } from "../src/app.ts";
import { descriptionViewSchema, errorSchema, inProgressSchema } from "../src/contract.ts";
import { scripts } from "../src/fixtures.ts";
import { mediaKeys } from "../src/media.ts";
import type { Script } from "../src/scripted-model.ts";
import { ALICE, settle, setup } from "./helpers.ts";

const PATH = "/notes/note-1/attachments/image-1/description";

function setupApp(script: Script = scripts.described, options: { hold?: boolean } = {}) {
  const job = setup(script, options);
  const logs: LogEntry[] = [];
  let requests = 0;
  // The context is the caller's owner segment: what the function URL adapter would derive.
  const app = createApp<{ owner?: string }>({
    describe: job.deps,
    ownerOf: (context) => context.owner,
    stage: "test",
    backend: "scripted",
    log: (entry) => logs.push(entry),
    newRequestId: () => `req-${(requests += 1)}`,
    now: () => +job.deps.now(),
  });
  /** `owner: null` is a request nothing vouched for. */
  const call = (method: string, path: string, owner: string | null = "alice") =>
    app(new Request(`http://api.test${path}`, { method }), owner === null ? {} : { owner });
  return { ...job, logs, call };
}

describe("PUT description", () => {
  it("describes the upload once, and says when it reused the stored one", async () => {
    const { call, model, logs } = setupApp();

    const first = await call("PUT", PATH);
    const second = await call("PUT", PATH);

    expect(first.status).toBe(200);
    expect(v.parse(descriptionViewSchema, await first.json())).toMatchObject({
      outcome: "described",
      text: "木の机の上に、開いたノートと青いペンが置かれている。",
      modelId: "jp.amazon.nova-2-lite-v1:0",
      reused: false,
    });
    expect(v.parse(descriptionViewSchema, await second.json()).reused).toBe(true);
    expect(model.requests).toHaveLength(1);
    // The billed tokens are logged for the call that paid, and null for the one that did not.
    expect(logs.map((entry) => entry["billed"])).toEqual([
      { inputTokens: 318, outputTokens: 27 },
      null,
    ]);
  });

  it("answers 202 with Retry-After while another request is generating", async () => {
    const { call, answer } = setupApp(scripts.described, { hold: true });

    const running = call("PUT", PATH);
    await settle();
    const waiting = await call("PUT", PATH);

    expect(waiting.status).toBe(202);
    expect(waiting.headers.get("retry-after")).toBe("2");
    expect(v.parse(inProgressSchema, await waiting.json()).retryAfterSeconds).toBe(2);
    expect((await call("GET", PATH)).status).toBe(202);
    await answer();
    expect((await running).status).toBe(200);
    expect((await call("GET", PATH)).status).toBe(200);
  });

  it("leaves out the text when the model declined", async () => {
    const { call } = setupApp(scripts.refused);

    const body = v.parse(descriptionViewSchema, await (await call("PUT", PATH)).json());

    expect(body.outcome).toBe("refused");
    expect(body.text).toBeUndefined();
  });

  it.each([
    ["throttled-then-described", 429, "throttled", true],
    ["max-tokens", 502, "bad_output", false],
  ] as const)("turns a %s failure into %i", async (name, status, code, retryable) => {
    const { call } = setupApp(scripts[name]);

    const response = await call("PUT", PATH);

    expect(response.status).toBe(status);
    expect(v.parse(errorSchema, await response.json()).error).toMatchObject({ code, retryable });
  });

  it("answers 422 for an upload Converse cannot read", async () => {
    const { call, media } = setupApp();
    media.seed(mediaKeys(ALICE).source, new Uint8Array(10), "image/svg+xml");

    const response = await call("PUT", PATH);

    expect(response.status).toBe(422);
    expect(v.parse(errorSchema, await response.json()).error.code).toBe("unsupported_image");
  });
});

describe("who may ask", () => {
  it("answers 401 when nothing in front of the function vouched for the caller", async () => {
    const { call, model } = setupApp();

    for (const method of ["PUT", "GET", "DELETE"]) {
      expect((await call(method, PATH, null)).status).toBe(401);
    }
    expect((await call("GET", "/me", null)).status).toBe(401);
    expect(model.requests).toHaveLength(0);
  });

  it("shows another user neither the upload nor what was generated from it", async () => {
    const { call, model, media } = setupApp();
    await call("PUT", PATH);

    const put = await call("PUT", PATH, "bob");
    const get = await call("GET", PATH, "bob");
    const del = await call("DELETE", PATH, "bob");

    expect([put.status, get.status, del.status]).toEqual([404, 404, 204]);
    expect(v.parse(errorSchema, await put.json()).error.code).toBe("attachment_missing");
    // Bob's requests reached neither the model nor Alice's objects.
    expect(model.requests).toHaveLength(1);
    expect(media.keys("g/")).toEqual([mediaKeys(ALICE).description]);
  });

  it.each([
    "/notes/..%2F..%2Fu%2Falice%2Fnote-1/attachments/image-1/description",
    "/notes/note-1/attachments/image-1%2F..%2F..%2F..%2Falice/description",
    "/notes/note%201/attachments/image-1/description",
  ])("answers 404 for %s without touching anything", async (path) => {
    const { call, model, media } = setupApp();

    const response = await call("PUT", path, "bob");

    expect(response.status).toBe(404);
    expect(model.requests).toHaveLength(0);
    expect(media.keys("c/")).toEqual([]);
  });

  it("tells the caller which owner segment its uploads live under", async () => {
    const { call } = setupApp();

    expect(await (await call("GET", "/me")).json()).toEqual({ owner: "alice" });
  });
});

describe("GET and DELETE", () => {
  it("never calls the model from GET", async () => {
    const { call, model } = setupApp();

    const response = await call("GET", PATH);

    expect(response.status).toBe(404);
    expect(v.parse(errorSchema, await response.json()).error.code).toBe("not_described");
    expect(model.requests).toHaveLength(0);
  });

  it("deletes the description, after which PUT pays for a new one", async () => {
    const { call, model } = setupApp();
    await call("PUT", PATH);

    expect((await call("DELETE", PATH)).status).toBe(204);
    expect((await call("GET", PATH)).status).toBe(404);
    expect(v.parse(descriptionViewSchema, await (await call("PUT", PATH)).json()).reused).toBe(
      false,
    );
    expect(model.requests).toHaveLength(2);
  });
});

describe("the shell around the routes", () => {
  it("puts a request ID on every answer, errors included", async () => {
    const { call } = setupApp();

    const missing = await call("GET", "/nowhere");

    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-request-id")).toBe("req-1");
    expect(v.parse(errorSchema, await missing.json()).error.requestId).toBe("req-1");
  });

  it("answers 500 without the detail when a stored description cannot be read", async () => {
    const { call, media, logs } = setupApp();
    await media.putIfAbsent(mediaKeys(ALICE).description, "not json");

    const response = await call("GET", PATH);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("JSON");
    expect(logs.at(-1)).toMatchObject({ level: "error", message: "unhandled error" });
  });
});
