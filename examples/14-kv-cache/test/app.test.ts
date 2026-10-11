import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { type AppDeps, createApp } from "../src/app.ts";
import { errorSchema, itemListSchema, itemSchema } from "../src/contract.ts";
import type { LogEntry } from "../src/log.ts";
import { MemoryCacheStore, MemoryCounterStore } from "../src/memory-store.ts";
import { createRateLimiter } from "../src/rate-limit.ts";
import { createReadThrough } from "../src/read-through.ts";

const T0 = 29_000_000 * 60_000;

function setup(overrides: Partial<AppDeps> = {}) {
  const clock = { now: T0 };
  const logs: LogEntry[] = [];
  let loads = 0;
  let requests = 0;
  const app = createApp({
    env: { STAGE: "test", KV_STORE: "memory", RATE_ON_ERROR: "allow" },
    limiter: createRateLimiter(new MemoryCounterStore(), { limit: 2, windowMs: 60_000, algorithm: "fixed" }),
    source: {
      list: async () => {
        loads++;
        return [{ id: "notebook", name: "Notebook", priceYen: 480 }];
      },
    },
    cache: createReadThrough({
      store: new MemoryCacheStore(),
      schema: z.array(itemSchema),
      ttlMs: 30_000,
      jitter: 0,
      random: () => 0,
      now: () => clock.now,
    }),
    log: (entry) => logs.push(entry),
    newRequestId: () => `req-${++requests}`,
    now: () => clock.now,
    ...overrides,
  });
  const items = (clientId: string | null = "client-1") =>
    app.request("/items", clientId === null ? {} : { headers: { "x-client-id": clientId } });
  return { app, clock, logs, items, loads: () => loads };
}

describe("GET /items", () => {
  it("answers from the source first and from the cache after, and says which", async () => {
    const { items, clock, loads } = setup();
    const first = await items();
    expect(first.status).toBe(200);
    expect(first.headers.get("x-cache")).toBe("miss");
    expect(itemListSchema.parse(await first.json()).loadedAt).toBe(new Date(T0).toISOString());

    clock.now += 12_000;
    const second = await items();
    expect(second.headers.get("x-cache")).toBe("hit");
    // The body still carries the time the list left the source; `age` says how long ago that was.
    expect(itemListSchema.parse(await second.json()).loadedAt).toBe(new Date(T0).toISOString());
    expect(second.headers.get("age")).toBe("12");
    expect(loads()).toBe(1);
  });

  it("refuses the request after the limit with 429 and Retry-After", async () => {
    const { items, clock } = setup();
    expect((await items()).headers.get("ratelimit-remaining")).toBe("1");
    expect((await items()).headers.get("ratelimit-remaining")).toBe("0");
    clock.now += 20_000;
    const refused = await items();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("40");
    expect(errorSchema.parse(await refused.json()).error.code).toBe("rate_limited");
    // Another client is unaffected.
    expect((await items("client-2")).status).toBe(200);
  });

  it("does not touch the cache or the source for a refused request", async () => {
    const { items, loads } = setup();
    await items();
    await items();
    await items();
    expect(loads()).toBe(1);
  });

  it("requires a well-formed client ID before counting anything", async () => {
    const { items } = setup();
    expect((await items(null)).status).toBe(400);
    expect((await items("a b")).status).toBe(400);
    expect((await items("x".repeat(65))).status).toBe(400);
  });
});

describe("when the counter store is down", () => {
  const failing = {
    hit: async (): Promise<never> => {
      throw new Error("connection refused");
    },
  };

  it("lets the request through when told to stay available, and logs it", async () => {
    const { items, logs } = setup({ limiter: failing });
    const response = await items();
    expect(response.status).toBe(200);
    expect(response.headers.get("ratelimit-remaining")).toBeNull();
    expect(logs.some((entry) => entry.message === "rate limiter failed")).toBe(true);
  });

  it("refuses with 503 when told to stay strict", async () => {
    const { items } = setup({
      limiter: failing,
      env: { STAGE: "test", KV_STORE: "memory", RATE_ON_ERROR: "deny" },
    });
    const response = await items();
    expect(response.status).toBe(503);
    expect(errorSchema.parse(await response.json()).error.code).toBe("unavailable");
  });
});

describe("the rest of the API", () => {
  it("reports which store it runs on, without being rate limited", async () => {
    const { app } = setup();
    for (let request = 0; request < 5; request++) {
      expect((await app.request("/health")).status).toBe(200);
    }
    expect(await (await app.request("/health")).json()).toEqual({ status: "ok", stage: "test", store: "memory" });
  });

  it("puts the same request ID in the header, the error body, and the log", async () => {
    const { app, logs } = setup();
    const response = await app.request("/nope");
    const body = errorSchema.parse(await response.json());
    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(body.error.requestId);
    expect(logs.at(-1)).toMatchObject({ requestId: body.error.requestId, status: 404 });
  });

  it("answers a failing source with 500 and no detail", async () => {
    const { items } = setup({
      source: {
        list: async () => {
          throw new Error("SELECT failed: password authentication failed for user admin");
        },
      },
    });
    const response = await items();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("password");
  });
});
