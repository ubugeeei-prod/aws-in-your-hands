import type { LogEntry } from "@aih/example-04-http-api/src/log.ts";
import { describe, expect, it } from "vite-plus/test";
import { composeServer, quietHealth, withVersion } from "../src/compose.ts";
import { parseServerEnv } from "../src/env.ts";
import { summarize } from "../src/watch.ts";

const base = { ALLOWED_ORIGIN: "http://localhost:5173" };

describe("parseServerEnv", () => {
  it("defaults to an unprivileged port and a version that says it is not a release", () => {
    expect(parseServerEnv(base)).toMatchObject({ PORT: 8080, APP_VERSION: "dev", STAGE: "local" });
  });

  it("names the variable that is wrong", () => {
    expect(() => parseServerEnv({ ...base, PORT: "http" })).toThrow(/PORT/);
    expect(() => parseServerEnv({ PORT: "8080" })).toThrow(/ALLOWED_ORIGIN/);
  });
});

describe("what the container adds around the chapter 04 app", () => {
  it("stamps every response with the version, errors included", async () => {
    const { fetch } = composeServer({ ...base, LOG_LEVEL: "error", APP_VERSION: "v7" });
    const ok = await fetch(new Request("http://task/health"));
    const missing = await fetch(new Request("http://task/nowhere"));
    expect([ok.status, ok.headers.get("x-app-version")]).toEqual([200, "v7"]);
    expect([missing.status, missing.headers.get("x-app-version")]).toEqual([404, "v7"]);
    // The app's own header survives the wrapper.
    expect(ok.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps successful health checks out of the log, and nothing else", () => {
    const entries: LogEntry[] = [];
    const log = quietHealth((entry) => entries.push(entry));
    log({ level: "info", message: "request", path: "/health", status: 200 });
    log({ level: "error", message: "request", path: "/health", status: 500 });
    log({ level: "info", message: "request", path: "/notes", status: 200 });
    log({ level: "info", message: "listening" });
    expect(entries.map((entry) => [entry.message, entry["path"], entry["status"]])).toEqual([
      ["request", "/health", 500],
      ["request", "/notes", 200],
      ["listening", undefined, undefined],
    ]);
  });

  it("leaves the response of the wrapped handler otherwise alone", async () => {
    const wrapped = withVersion(() => new Response("body", { status: 418, headers: { "x-kept": "yes" } }), "v1");
    const response = await wrapped(new Request("http://task/"));
    expect([response.status, response.headers.get("x-kept"), await response.text()]).toEqual([418, "yes", "body"]);
  });
});

describe("summarize", () => {
  it("counts answers per version and anything that was not a 200", () => {
    expect(
      summarize([
        { status: 200, version: "v1" },
        { status: 200, version: "v2" },
        { status: 200, version: "v1" },
        { status: 502, version: "(no header)" },
        { status: 0, version: "TimeoutError" },
      ]),
    ).toEqual(["5 requests", "  v1: 2 x 200", "  v2: 1 x 200", "  2 failed"]);
    expect(summarize([{ status: 200, version: "v1" }]).at(-1)).toBe("  no request failed");
  });
});
