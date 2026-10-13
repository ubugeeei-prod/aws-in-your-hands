import { describe, expect, it } from "vite-plus/test";

import { asyncScope } from "@aih/example-35-lambda-managed-instances/src/scope.ts";

import { composeWebApp, RELEASE_HEADER } from "../src/app.ts";
import { objectLogger } from "../src/log.ts";
import { as, createNote, harness, storedBy } from "./harness.ts";

const url = (path: string) => `http://api.test${path}`;

describe("the request ID", () => {
  it("is the one Lambda assigned, in the answer and in what the store logs", async () => {
    const test = harness(asyncScope);
    test.release();
    const response = await test.app(new Request(url("/notes"), as("req-1", createNote("a"))));
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(storedBy(test.lines, "note-1")).toBe("req-1");
    expect(test.lines.at(-1)).toMatchObject({
      message: "request",
      requestId: "req-1",
      status: 201,
    });
  });

  it("is made here when the header is missing, as on a laptop", async () => {
    const { app } = harness(asyncScope);
    const response = await app(new Request(url("/health")));
    expect(response.headers.get("x-request-id")).toBe("generated-1");
  });

  it("is made here when the header is not a plain token", async () => {
    const { app } = harness(asyncScope);
    for (const value of ["", "a b", "x".repeat(129), "<script>"]) {
      const response = await app(new Request(url("/health"), as(value)));
      expect(response.headers.get("x-request-id"), value).toMatch(/^generated-\d+$/);
    }
  });

  it("is in the error body too, so a caller can quote it", async () => {
    const { app } = harness(asyncScope);
    const response = await app(new Request(url("/notes/none"), as("req-404")));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "not_found", requestId: "req-404" },
    });
  });
});

describe("what the environment decides", () => {
  const env = { ALLOWED_ORIGIN: "http://localhost:5173" };

  it("names the upload on every answer, and 'local' when there is none", async () => {
    const local = await composeWebApp({ ...env, LOG_LEVEL: "error" })(new Request(url("/health")));
    expect(local.headers.get(RELEASE_HEADER)).toBe("local");
    const deployed = await composeWebApp({
      ...env,
      LOG_LEVEL: "error",
      RELEASE: "3HL4kqtJlcpXroDTDmJ.rUAxGoBu1Tuw",
    })(new Request(url("/health")));
    expect(deployed.headers.get(RELEASE_HEADER)).toBe("3HL4kqtJlcpXroDTDmJ.rUAxGoBu1Tuw");
  });

  it("stops at start on an environment chapter 04 would refuse", () => {
    expect(() => composeWebApp({})).toThrow(/ALLOWED_ORIGIN/);
  });
});

describe("the logger used on Lambda", () => {
  it("hands console an object, under the method that carries the level", () => {
    const calls: [string, unknown][] = [];
    const sink = {
      debug: (entry: unknown) => calls.push(["debug", entry]),
      info: (entry: unknown) => calls.push(["info", entry]),
      warn: (entry: unknown) => calls.push(["warn", entry]),
      error: (entry: unknown) => calls.push(["error", entry]),
    };
    const log = objectLogger("info", { release: "v1" }, sink);
    log({ level: "debug", message: "dropped" });
    log({ level: "info", message: "request", status: 200 });
    log({ level: "error", message: "unhandled error" });
    expect(calls).toEqual([
      ["info", { level: "info", message: "request", status: 200, release: "v1" }],
      ["error", { level: "error", message: "unhandled error", release: "v1" }],
    ]);
  });
});
