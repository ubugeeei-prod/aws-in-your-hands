import { describe, expect, it } from "vite-plus/test";

import { LIMITS } from "../src/config.ts";
import { startedBy } from "../src/job.ts";
import { estimateUsd, reap, startOfUtcDay } from "../src/limits.ts";

const NOW = new Date("2026-10-13T03:30:00Z");
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
const task = (name: string, deadline: Date) => ({
  taskArn: `arn:aws:ecs:ap-northeast-1:111111111111:task/sandbox/${name}`,
  startedBy: startedBy(`0b9f6c1e-52a7-4a3e-9d55-3f1f0c2a7e1${name}`, seconds(deadline)),
});
const MODEL = "jp.anthropic.claude-haiku-4-5-20251001-v1:0";

describe("the reaper's decision", () => {
  const early = task("0", new Date("2026-10-13T03:29:59Z"));
  const exact = task("1", NOW);
  const later = task("2", new Date("2026-10-13T03:45:00Z"));

  it("stops a task at its deadline, not a second before", () => {
    expect(reap([early, exact, later], NOW, 0)).toEqual([
      { taskArn: early.taskArn, reason: "deadline" },
      { taskArn: exact.taskArn, reason: "deadline" },
    ]);
  });

  it("stops every task once the day's budget is spent", () => {
    expect(reap([later], NOW, LIMITS.dailyUsd - 0.01)).toEqual([]);
    expect(reap([later], NOW, LIMITS.dailyUsd)).toEqual([
      { taskArn: later.taskArn, reason: "daily_budget" },
    ]);
  });

  it("stops a task the launcher did not start: it has no deadline to keep", () => {
    const stray = {
      taskArn: "arn:aws:ecs:ap-northeast-1:111111111111:task/sandbox/s",
      startedBy: undefined,
    };
    const forged = { ...later, startedBy: "aih/9999999999/not-a-job-id" };
    expect(reap([stray, forged, later], NOW, 0).map((stop) => stop.reason)).toEqual([
      "not_started_by_launcher",
      "not_started_by_launcher",
    ]);
  });
});

describe("the outside estimate of spend", () => {
  it("prices each kind of token at the pinned model's list price", () => {
    const tokens = {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
    };
    // 1.10 + 5.50 + 0.11 + 1.375 per million, from the Price List by way of chapter 36.
    expect(estimateUsd(tokens, MODEL)).toBeCloseTo(8.085, 6);
    expect(estimateUsd({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, MODEL)).toBe(0);
  });

  it("counts from 00:00 UTC", () => {
    expect(startOfUtcDay(NOW).toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(startOfUtcDay(new Date("2026-10-13T23:59:59+09:00")).toISOString()).toBe(
      "2026-10-13T00:00:00.000Z",
    );
  });
});
