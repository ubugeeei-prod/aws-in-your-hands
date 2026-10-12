import { describe, expect, it } from "vite-plus/test";

import { parseRegionalEnv } from "../src/env.ts";
import { createRegionalApp, HEALTH_PATH, REGION_HEADER } from "../src/regional-app.ts";
import { PRIMARY_REGION as TOKYO, STANDBY_REGION as OSAKA } from "../src/regions.ts";

const inner = async (request: Request) =>
  Response.json({ method: request.method }, { headers: { "x-request-id": "r1" } });

const app = (overrides: Partial<Parameters<typeof createRegionalApp>[0]> = {}) =>
  createRegionalApp({
    app: inner,
    region: TOKYO,
    writes: "accept",
    probe: async () => {},
    probeTimeoutMs: 20,
    ...overrides,
  });

const get = (path: string) => new Request(`http://api.test${path}`);
const post = (path: string) =>
  new Request(`http://api.test${path}`, { method: "POST", body: "{}" });

describe("the regional wrapper", () => {
  it("names the Region on every answer and keeps the inner headers", async () => {
    const response = await app({ region: OSAKA })(get("/notes"));
    expect(response.headers.get(REGION_HEADER)).toBe(OSAKA);
    expect(response.headers.get("x-request-id")).toBe("r1");
    expect(await response.json()).toEqual({ method: "GET" });
  });

  it("answers the health check from this Region's table, not from memory", async () => {
    let probes = 0;
    const response = await app({
      probe: async () => {
        probes++;
      },
    })(get(HEALTH_PATH));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", region: TOKYO, writes: "accept" });
    expect(probes).toBe(1);
  });

  it("answers 503 without the reason when the table cannot be read", async () => {
    const response = await app({
      probe: async () => {
        throw new Error("AccessDeniedException: arn:aws:dynamodb:...");
      },
    })(get(HEALTH_PATH));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("AccessDenied");
    expect(response.headers.get(REGION_HEADER)).toBe(TOKYO);
  });

  it("answers 503 in time when the table does not answer at all", async () => {
    const startedAt = Date.now();
    const response = await app({ probe: () => new Promise(() => {}) })(get(HEALTH_PATH));
    expect(response.status).toBe(503);
    // Route 53 waits two seconds. The limit is the 20 ms set above, with room for a slow machine.
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});

describe("a failover drill", () => {
  it("fails the health check without touching the table, while requests are still served", async () => {
    let probes = 0;
    const drilled = app({
      failHealth: true,
      probe: async () => {
        probes++;
      },
    });
    expect((await drilled(get(HEALTH_PATH))).status).toBe(503);
    expect(probes).toBe(0);
    // The state the stale-DNS test is about: reported down, in fact up.
    expect((await drilled(get("/notes"))).status).toBe(200);
    expect((await drilled(post("/notes"))).status).toBe(200);
  });
});

describe("a Region that refuses writes", () => {
  const standby = app({ region: OSAKA, writes: "refuse" });

  it("turns every changing method away with 503 and a hint to retry", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const response = await standby(new Request("http://api.test/notes/n1", { method }));
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("30");
      expect(await response.json()).toMatchObject({ error: { code: "read_only_region" } });
    }
  });

  it("still reads, answers preflight, and reports healthy", async () => {
    expect((await standby(get("/notes"))).status).toBe(200);
    expect(
      (await standby(new Request("http://api.test/notes", { method: "OPTIONS" }))).status,
    ).toBe(200);
    const health = await standby(get(HEALTH_PATH));
    expect(await health.json()).toEqual({ status: "ok", region: OSAKA, writes: "refuse" });
  });

  it("does not hand the write to the inner app", async () => {
    let reached = false;
    const guarded = app({
      writes: "refuse",
      app: async () => {
        reached = true;
        return new Response(null, { status: 204 });
      },
    });
    await guarded(post("/notes"));
    expect(reached).toBe(false);
  });
});

describe("the environment", () => {
  it("accepts only the two Regions the stacks are written for", () => {
    expect(parseRegionalEnv({ REGION: OSAKA })).toEqual({
      REGION: OSAKA,
      WRITES: "accept",
      HEALTH: "probe",
    });
    expect(() => parseRegionalEnv({ REGION: "us-east-1" })).toThrow(/REGION/);
    expect(() => parseRegionalEnv({})).toThrow(/REGION/);
  });

  it("does not guess what a misspelled write mode meant", () => {
    expect(() => parseRegionalEnv({ REGION: TOKYO, WRITES: "refused" })).toThrow(/WRITES/);
  });
});
