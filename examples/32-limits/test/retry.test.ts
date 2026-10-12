import { describe, expect, it } from "vite-plus/test";

import { createRetryBudget } from "../src/retry-budget.ts";
import { isRetryable, type RetryPolicy, retryAfterMs, sendWithRetry } from "../src/retry.ts";

const policy: RetryPolicy = {
  maxAttempts: 4,
  backoff: { baseMs: 100, capMs: 2000, jitter: "full" },
  maxWaitMs: 5000,
};

/** Answers with the given statuses in order, and records every wait asked for. */
function scripted(answers: (number | Response)[]) {
  const sleeps: number[] = [];
  let sent = 0;
  return {
    sleeps,
    sent: () => sent,
    send: async () => {
      const answer = answers[Math.min(sent, answers.length - 1)] ?? 500;
      sent += 1;
      return typeof answer === "number" ? new Response(null, { status: answer }) : answer.clone();
    },
    deps: {
      // Half of every window, so the waits are easy to read.
      random: () => 0.5,
      sleep: async (ms: number) => void sleeps.push(ms),
      now: () => Date.UTC(2026, 9, 12),
    },
  };
}

describe("which answers are sent again", () => {
  it("sends a 429 again whatever the method: nothing was done", () => {
    expect(["GET", "POST", "PUT", "DELETE"].every((method) => isRetryable(method, 429))).toBe(true);
  });

  it("sends a 503 again only when repeating the request is harmless", () => {
    expect(isRetryable("GET", 503)).toBe(true);
    expect(isRetryable("PUT", 502)).toBe(true);
    expect(isRetryable("DELETE", 504)).toBe(true);
    // The first POST may have created the note before the answer was lost.
    expect(isRetryable("POST", 503)).toBe(false);
  });

  it("never sends again what the caller got wrong, nor a plain 500", () => {
    expect([400, 401, 403, 404, 409, 413, 500].some((status) => isRetryable("GET", status))).toBe(
      false,
    );
  });
});

describe("retry-after", () => {
  const now = Date.UTC(2026, 9, 12, 0, 0, 0);

  it("reads seconds and dates, and ignores anything else", () => {
    expect(retryAfterMs("3", now)).toBe(3000);
    expect(retryAfterMs("Mon, 12 Oct 2026 00:00:07 GMT", now)).toBe(7000);
    expect(retryAfterMs("Mon, 12 Oct 2026 00:00:00 GMT", now + 5000)).toBe(0);
    expect(retryAfterMs("soon", now)).toBeUndefined();
    expect(retryAfterMs("-1", now)).toBeUndefined();
    expect(retryAfterMs(null, now)).toBeUndefined();
  });
});

describe("sendWithRetry", () => {
  it("waits longer each time and stops at the first answer that is not a refusal", async () => {
    const server = scripted([429, 429, 200]);

    const outcome = await sendWithRetry("POST", server.send, policy, server.deps);

    expect(outcome).toMatchObject({ attempts: 3, stopped: "answered", waitedMs: 150 });
    expect(outcome.response.status).toBe(200);
    expect(server.sleeps).toEqual([50, 100]);
  });

  it("gives up after the last attempt and returns the refusal itself", async () => {
    const server = scripted([429]);

    const outcome = await sendWithRetry("GET", server.send, policy, server.deps);

    expect(outcome).toMatchObject({ attempts: 4, stopped: "attempts" });
    expect(outcome.response.status).toBe(429);
    expect(server.sent()).toBe(4);
  });

  it("does not repeat a POST whose answer was a 503", async () => {
    const server = scripted([503, 201]);

    const outcome = await sendWithRetry("POST", server.send, policy, server.deps);

    expect(outcome).toMatchObject({ attempts: 1, stopped: "answered" });
    expect(server.sent()).toBe(1);
  });

  it("waits at least as long as the server asks", async () => {
    const refused = new Response(null, { status: 429, headers: { "retry-after": "2" } });
    const server = scripted([refused, 200]);

    await sendWithRetry("GET", server.send, policy, server.deps);

    expect(server.sleeps).toEqual([2000]);
  });

  it("does not wait an hour because a server said so", async () => {
    const refused = new Response(null, { status: 429, headers: { "retry-after": "3600" } });
    const server = scripted([refused, 200]);

    const outcome = await sendWithRetry("GET", server.send, policy, server.deps);

    expect(outcome).toMatchObject({ attempts: 1, stopped: "wait_too_long" });
    expect(server.sleeps).toEqual([]);
  });

  it("stops retrying across calls once the shared budget is spent", async () => {
    const budget = createRetryBudget({ capacity: 10, retryCost: 5, successRefund: 1 });
    const server = scripted([429]);
    const deps = { ...server.deps, budget };

    const first = await sendWithRetry("GET", server.send, policy, deps);
    const second = await sendWithRetry("GET", server.send, policy, deps);

    // Two retries were all the budget held. The second call got its first attempt and nothing more.
    expect(first).toMatchObject({ attempts: 3, stopped: "budget" });
    expect(second).toMatchObject({ attempts: 1, stopped: "budget" });
    expect(server.sent()).toBe(4);
  });

  it("refills the budget from calls that succeed", async () => {
    const budget = createRetryBudget({ capacity: 10, retryCost: 5, successRefund: 1 });
    budget.spend();
    budget.spend();
    const healthy = scripted([200]);
    for (let index = 0; index < 5; index++) {
      await sendWithRetry("GET", healthy.send, policy, { ...healthy.deps, budget });
    }

    const server = scripted([429, 200]);
    const outcome = await sendWithRetry("GET", server.send, policy, { ...server.deps, budget });

    expect(outcome).toMatchObject({ attempts: 2, stopped: "answered" });
    expect(budget.available()).toBe(5);
  });
});
