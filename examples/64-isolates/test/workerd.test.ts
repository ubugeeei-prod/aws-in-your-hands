import * as v from "valibot";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { errorSchema, healthSchema, noteSchema } from "@aih/example-04-http-api/src/contract.ts";

import type { DeploymentInput } from "../src/definition.ts";
import { imageDeployment } from "../src/deployments.ts";
import { WORKERD } from "../src/release.ts";
import { INSTALLED, type Running } from "../src/runtime.ts";
import { bundles, heldPost, serve, waitForLine, workerdStarts } from "./harness.ts";

// These tests run the real workerd binary. Where it cannot start they are skipped, and say so.
const starts = workerdStarts();
if (!starts) {
  console.warn("workerd does not start on this machine: the tests in workerd.test.ts are skipped");
}

const notesWorker = (name: string, stage: string) => ({
  name,
  module: "notes.mjs",
  compatibilityDate: WORKERD.compatibilityDate,
  bindings: [
    { from: "text" as const, name: "ALLOWED_ORIGIN", value: "http://localhost:5173" },
    { from: "text" as const, name: "STAGE", value: stage },
  ],
});
const scopedWorker = (name: string, scope: "module" | "async") => ({
  name,
  module: "scoped.mjs",
  compatibilityDate: WORKERD.compatibilityDate,
  bindings: [
    { from: "text" as const, name: "ALLOWED_ORIGIN", value: "http://localhost:5173" },
    { from: "text" as const, name: "SCOPE", value: scope },
  ],
});
// The port is replaced by one the kernel picks; it only has to differ between sockets.
const socket = (name: string, port = 1) => ({ name, address: `127.0.0.1:${port}`, service: name });
const post = (title: string): RequestInit => ({
  method: "POST",
  body: JSON.stringify({ title, body: "" }),
});

describe.skipIf(!starts)("the pinned workerd", () => {
  let built: Awaited<ReturnType<typeof bundles>>;
  const running: Running[] = [];
  const start = async (input: DeploymentInput, environment?: Record<string, string>) => {
    const server = await serve(built.directory, input, environment);
    running.push(server);
    return server;
  };

  beforeAll(async () => {
    built = await bundles();
  });
  afterAll(async () => {
    await Promise.all(running.map((server) => server.stop()));
    built.remove();
  });

  it("is the version src/release.ts names", () => {
    expect(INSTALLED).toMatchObject({
      version: WORKERD.version,
      compatibilityDate: WORKERD.compatibilityDate,
    });
  });

  // #region unchanged
  describe("running chapter 04's app", () => {
    let api: string;
    let server: Running;
    beforeAll(async () => {
      // A quote and a backslash, to see the escaping in capnp.ts through to the worker.
      server = await start({
        workers: [notesWorker("notes", 'st"a\\ge')],
        sockets: [socket("notes")],
      });
      api = server.url["notes"] ?? "";
    });

    it("answers as the contract says, with the binding's value", async () => {
      const response = await fetch(`${api}/health`);
      expect(response.status).toBe(200);
      expect(v.parse(healthSchema, await response.json())).toEqual({
        status: "ok",
        stage: 'st"a\\ge',
      });
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("stores a note, returns it, and refuses a bad one in the usual shape", async () => {
      const created = await fetch(`${api}/notes`, post("in workerd"));
      expect(created.status).toBe(201);
      const note = v.parse(noteSchema, await created.json());
      expect(v.parse(noteSchema, await (await fetch(`${api}/notes/${note.id}`)).json())).toEqual(
        note,
      );

      const refused = await fetch(`${api}/notes`, { method: "POST", body: '{"title":""}' });
      expect(refused.status).toBe(400);
      expect(v.parse(errorSchema, await refused.json()).error.code).toBe("invalid_request");
    });

    it("answers the preflight for the allowed origin", async () => {
      const response = await fetch(`${api}/notes`, {
        method: "OPTIONS",
        headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    });

    it("writes the app's log lines to standard output, one JSON object each", async () => {
      await fetch(`${api}/health`);
      const line = await waitForLine(server.lines, (entry) => entry["path"] === "/health");
      expect(line).toMatchObject({ level: "info", message: "request", method: "GET", status: 200 });
    });
  });
  // #endregion unchanged

  // #region apart
  it("keeps two workers in one process apart, though they run the same code", async () => {
    const server = await start({
      workers: [notesWorker("tenant-a", "a"), notesWorker("tenant-b", "b")],
      sockets: [socket("tenant-a", 1), socket("tenant-b", 2)],
    });
    const [a = "", b = ""] = [server.url["tenant-a"], server.url["tenant-b"]];

    const created = await fetch(`${a}/notes`, post("belongs to A"));
    const note = v.parse(noteSchema, await created.json());

    // One process, one bundle on disk, two module scopes: B's Map never saw the note.
    expect(await (await fetch(`${b}/notes`)).json()).toEqual({ notes: [] });
    expect((await fetch(`${b}/notes/${note.id}`)).status).toBe(404);
    expect((await fetch(`${a}/notes/${note.id}`)).status).toBe(200);
    // Each got its own bindings, too.
    expect(await (await fetch(`${b}/health`)).json()).toEqual({ status: "ok", stage: "b" });
  });
  // #endregion apart

  // #region leak
  /** Request A stops inside its body. Request B arrives and is answered. Only then A goes on. */
  async function interleave(scope: "module" | "async") {
    const server = await start({
      workers: [scopedWorker("scoped", scope)],
      sockets: [socket("scoped")],
    });
    const api = server.url["scoped"] ?? "";

    const a = heldPost(`${api}/notes`, JSON.stringify({ title: "from A", body: "" }));
    const b = await fetch(`${api}/health`);
    const answer = await a.finish();
    const note = v.parse(noteSchema, JSON.parse(answer.body));
    const stored = await waitForLine(
      server.lines,
      (entry) => entry["message"] === "note stored" && entry["noteId"] === note.id,
    );
    return { a: answer.requestId, b: b.headers.get("x-request-id"), storedBy: stored["requestId"] };
  }

  it("shares module scope between two requests in flight in one isolate", async () => {
    const { a, b, storedBy } = await interleave("module");
    expect(a).not.toBe(b);
    // Each caller got its own ID back. The log says B stored A's note.
    expect(storedBy).toBe(b);
  });

  it("keeps them apart with AsyncLocalStorage, which workerd provides", async () => {
    const { a, b, storedBy } = await interleave("async");
    expect(a).not.toBe(b);
    expect(storedBy).toBe(a);
  });
  // #endregion leak

  it("takes a binding from the environment workerd was started with, and leaves an unset one out", async () => {
    const server = await start(
      {
        workers: [
          {
            name: "notes",
            module: "notes.mjs",
            compatibilityDate: WORKERD.compatibilityDate,
            bindings: [
              { from: "environment", name: "ALLOWED_ORIGIN", variable: "ALLOWED_ORIGIN" },
              { from: "environment", name: "STAGE", variable: "STAGE" },
            ],
          },
        ],
        sockets: [socket("notes")],
      },
      { ALLOWED_ORIGIN: "https://notes.example" },
    );
    const response = await fetch(`${server.url["notes"]}/health`, {
      headers: { origin: "https://notes.example" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("https://notes.example");
    // STAGE was not set, so chapter 04's default applies.
    expect(await response.json()).toEqual({ status: "ok", stage: "local" });
  });

  // #region image
  it("accepts the very configuration the image carries, given the task definition's variables", async () => {
    const server = await start(imageDeployment, {
      ALLOWED_ORIGIN: "http://localhost:5173",
      LOG_LEVEL: "info",
      STAGE: "dev",
    });
    const response = await fetch(`${server.url["http"]}/health`, {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", stage: "dev" });
  });
  // #endregion image

  it("answers every request with an error when a required setting is missing", async () => {
    const server = await start({
      workers: [
        {
          name: "notes",
          module: "notes.mjs",
          compatibilityDate: WORKERD.compatibilityDate,
          bindings: [{ from: "environment", name: "ALLOWED_ORIGIN", variable: "ALLOWED_ORIGIN" }],
        },
      ],
      sockets: [socket("notes")],
    });
    // The health check fails too, which is what stops a broken deployment from taking traffic.
    expect((await fetch(`${server.url["notes"]}/health`)).status).toBe(500);
    expect((await fetch(`${server.url["notes"]}/health`)).status).toBe(500);
  });
});
