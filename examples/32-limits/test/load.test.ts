import { describe, expect, it } from "vite-plus/test";

import { firstLimit, localTarget, percentile, schedule, summarize } from "../src/load.ts";

describe("where load may be sent", () => {
  it("is this machine", () => {
    expect(localTarget("http://localhost:8787").host).toBe("localhost:8787");
    expect(localTarget("http://127.0.0.1:8787/health").pathname).toBe("/health");
    expect(localTarget("http://[::1]:8787").hostname).toBe("[::1]");
  });

  it("is never a deployed API, however the address is dressed up", () => {
    for (const target of [
      "https://abc123.execute-api.ap-northeast-1.amazonaws.com",
      "http://abc123.execute-api.ap-northeast-1.amazonaws.com",
      "https://localhost:8787",
      "http://localhost.example.com",
      "http://localhost@example.com/",
      "http://192.168.0.10:8787",
      "http://0.0.0.0:8787",
    ]) {
      expect(() => localTarget(target), target).toThrow(/refusing/);
    }
  });
});

describe("the schedule", () => {
  it("fixes every start time in advance, evenly spaced", () => {
    expect(schedule(4, 1)).toEqual([0, 250, 500, 750]);
    expect(schedule(10, 30)).toHaveLength(300);
  });
});

describe("the summary", () => {
  const samples = [
    ...Array.from({ length: 95 }, (_, index) => ({ status: 200, latencyMs: index + 1 })),
    ...Array.from({ length: 5 }, () => ({ status: 201, latencyMs: 400 })),
    ...Array.from({ length: 100 }, () => ({ status: 429, latencyMs: 1 })),
  ];

  it("counts answers by status", () => {
    expect(summarize(samples)).toMatchObject({
      requests: 200,
      byAnswer: { "200": 95, "201": 5, "429": 100 },
    });
  });

  it("keeps apart the refusals that said when to come back", () => {
    const refusals = [
      { status: 429, latencyMs: 1 },
      { status: 429, latencyMs: 1, retryAfter: true },
      { status: 429, latencyMs: 1, retryAfter: true },
    ];
    expect(summarize(refusals).byAnswer).toEqual({ "429": 1, "429 retry-after": 2 });
  });

  it("measures only served requests, so fast refusals cannot flatter it", () => {
    expect(summarize(samples)).toMatchObject({ p50Ms: 50, p95Ms: 95, maxMs: 400 });
  });

  it("has no latency to report when nothing was served", () => {
    expect(summarize([{ status: 429, latencyMs: 1 }])).toMatchObject({
      p50Ms: undefined,
      p95Ms: undefined,
      maxMs: undefined,
    });
  });

  it("uses the nearest rank for a percentile", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 99)).toBe(4);
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([], 50)).toBeUndefined();
  });
});

describe("the first limit", () => {
  const step = (requestsPerSecond: number, byAnswer: Record<string, number>) => ({
    requestsPerSecond,
    summary: summarize(
      Object.entries(byAnswer).flatMap(([answer, count]) =>
        Array.from({ length: count }, () => ({
          status: Number.parseInt(answer, 10),
          latencyMs: 1,
          retryAfter: answer.endsWith("retry-after"),
        })),
      ),
    ),
  });

  it("is the lowest rate at which requests start to be refused", () => {
    const steps = [
      step(40, { "200": 100, "429": 300 }),
      step(5, { "200": 50 }),
      step(20, { "200": 120, "429 retry-after": 80 }),
      step(10, { "200": 100 }),
    ];
    expect(firstLimit(steps)?.requestsPerSecond).toBe(20);
  });

  it("counts a request that got no answer as a failure", () => {
    expect(firstLimit([step(5, { "200": 90, "0": 10 })])?.requestsPerSecond).toBe(5);
  });

  it("is not found when every step stayed under it", () => {
    expect(firstLimit([step(5, { "200": 50 }), step(10, { "200": 100 })])).toBeUndefined();
  });
});
