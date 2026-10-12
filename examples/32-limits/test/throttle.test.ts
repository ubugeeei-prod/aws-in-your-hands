import { describe, expect, it } from "vite-plus/test";

import type { NodeContext } from "@aih/example-04-http-api/src/http/node-server.ts";
import { MemoryCounterStore } from "@aih/example-14-kv-cache/src/memory-store.ts";
import { createRateLimiter } from "@aih/example-14-kv-cache/src/rate-limit.ts";

import { composeApp } from "../src/compose.ts";
import { sendWithRetry } from "../src/retry.ts";
import { callerLimit, stageThrottle } from "../src/throttle.ts";

const ENV = {
  ALLOWED_ORIGIN: "http://localhost:5173",
  LOG_LEVEL: "error",
  STAGE: "test",
  NOTES_STORE: "memory",
};

/** The development server's stack, with a clock the test moves. */
function setup(options: { callerLimit: number } = { callerLimit: 1000 }) {
  let clock = Date.UTC(2026, 9, 12);
  const now = () => clock;
  let reached = 0;
  const app = composeApp(ENV);
  const limiter = createRateLimiter(new MemoryCounterStore(), {
    limit: options.callerLimit,
    windowMs: 10_000,
    algorithm: "fixed",
  });
  const handler = stageThrottle(
    { ratePerSecond: 10, burst: 20 },
    now,
    callerLimit(limiter, now, (request: Request) => {
      reached += 1;
      return app(request);
    }),
  );
  const from =
    (remoteAddress: string) =>
    (path: string, init?: RequestInit): Promise<Response> =>
      Promise.resolve(handler(new Request(`http://api.test${path}`, init), { remoteAddress }));
  return {
    from,
    reached: () => reached,
    advance: (ms: number) => void (clock += ms),
    now,
  };
}

const statuses = async (responses: Promise<Response>[]) =>
  (await Promise.all(responses)).map((response) => response.status);

describe("the stage throttle's stand-in", () => {
  it("refuses with 429 before the app is reached, and the app never sees the request", async () => {
    const api = setup();
    const call = api.from("203.0.113.7");

    const answers = await statuses(Array.from({ length: 50 }, () => call("/health")));

    expect(answers.filter((status) => status === 200)).toHaveLength(20);
    expect(answers.filter((status) => status === 429)).toHaveLength(30);
    expect(api.reached()).toBe(20);
  });

  it("is one bucket for everybody: a noisy caller uses up a quiet one's share", async () => {
    const api = setup();
    await statuses(Array.from({ length: 50 }, () => api.from("203.0.113.7")("/health")));

    const quiet = await api.from("198.51.100.20")("/health");

    expect(quiet.status).toBe(429);
    // The stage's refusal carries no hint about when to come back.
    expect(quiet.headers.get("retry-after")).toBeNull();
  });

  it("lets ten more through for every second that passes", async () => {
    const api = setup();
    const call = api.from("203.0.113.7");
    await statuses(Array.from({ length: 50 }, () => call("/health")));

    api.advance(1000);
    const answers = await statuses(Array.from({ length: 50 }, () => call("/health")));

    expect(answers.filter((status) => status === 200)).toHaveLength(10);
  });
});

describe("the caller's own limit, behind the stage throttle", () => {
  it("stops one address and leaves the others alone", async () => {
    const api = setup({ callerLimit: 5 });
    const noisy = await statuses(
      Array.from({ length: 8 }, () => api.from("203.0.113.7")("/health")),
    );

    const quiet = await api.from("198.51.100.20")("/health");

    expect(noisy).toEqual([200, 200, 200, 200, 200, 429, 429, 429]);
    expect(quiet.status).toBe(200);
  });

  it("tells the caller when to come back", async () => {
    const api = setup({ callerLimit: 1 });
    const call = api.from("203.0.113.7");
    await call("/health");

    const refused = await call("/health");

    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("10");
    expect(await refused.json()).toMatchObject({ error: { code: "rate_limited" } });
  });
});

describe("a client that retries, against both limits", () => {
  const policy = {
    maxAttempts: 5,
    backoff: { baseMs: 100, capMs: 2000, jitter: "full" },
    maxWaitMs: 15_000,
  } as const;

  it("creates a note exactly once although its first attempts were refused", async () => {
    const api = setup();
    const call = api.from("203.0.113.7");
    // Someone else empties the bucket first.
    await statuses(Array.from({ length: 20 }, () => call("/health")));

    const outcome = await sendWithRetry(
      "POST",
      () =>
        call("/notes", {
          method: "POST",
          body: JSON.stringify({ title: "limits", body: "written after two refusals" }),
        }),
      policy,
      // The wait is not slept through: the test's clock is moved instead.
      { random: () => 0.5, sleep: async (ms) => api.advance(ms), now: api.now },
    );

    expect(outcome.response.status).toBe(201);
    expect(outcome.attempts).toBeGreaterThan(1);
    api.advance(1000);
    const list = (await (await call("/notes")).json()) as { notes: unknown[] };
    expect(list.notes).toHaveLength(1);
  });

  it("waits out the caller's window because the answer said how long", async () => {
    const api = setup({ callerLimit: 1 });
    const call = api.from("203.0.113.7");
    await call("/health");
    const sleeps: number[] = [];

    const outcome = await sendWithRetry("GET", () => call("/health"), policy, {
      random: () => 0.5,
      sleep: async (ms) => {
        sleeps.push(ms);
        api.advance(ms);
      },
      now: api.now,
    });

    expect(outcome).toMatchObject({ attempts: 2, stopped: "answered" });
    // Backoff alone would have waited 50 ms and been refused again.
    expect(sleeps).toEqual([10_000]);
  });
});

// The context type the development server passes is the one these wrappers expect.
const _context: NodeContext = { remoteAddress: undefined };
void _context;
