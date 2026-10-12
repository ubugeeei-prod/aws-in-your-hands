import { describe, expect, it } from "vite-plus/test";

import { timing } from "@aih/example-12-containers/src/timing.ts";

import { inFlightAt, stopOutcome } from "../src/drain.ts";
import { MODEL, POLICY } from "../src/model-defaults.ts";
import { morningCurve, simulate, summarize } from "../src/scaling.ts";

// A model of the documented behaviour, checked against itself. None of this is Application Auto Scaling.
describe("the model of target tracking over the morning curve", () => {
  const timeline = simulate(morningCurve(), POLICY, MODEL);
  const summary = summarize(timeline, MODEL);

  it("adds tasks only after the metric has been high for a while, and they serve later still", () => {
    // The load crosses 600 per task in minute 12. Three minutes above, then two to start.
    expect(timeline[12]?.perTask).toBe(660);
    expect(summary.firstOut).toEqual({ decided: 14, serving: 16 });
  });

  it("is over capacity during that lag, and not after it", () => {
    const over = timeline.filter((entry) => entry.overCapacity > 0);
    expect(over.map((entry) => [entry.minute, entry.overCapacity])).toEqual([[15, 240]]);
    expect(summary.overCapacity).toBe(240);
  });

  it("drops far more requests when a task takes five minutes to start", () => {
    const slow = summarize(simulate(morningCurve(), POLICY, { ...MODEL, startMinutes: 5 }), MODEL);
    expect(slow.overCapacity).toBe(2700);
  });

  it("never leaves the range the policy allows", () => {
    for (const entry of timeline) {
      expect(entry.desired).toBeGreaterThanOrEqual(POLICY.minTasks);
      expect(entry.desired).toBeLessThanOrEqual(POLICY.maxTasks);
      // In the minute of a scale-in the removed tasks were still serving.
      expect(entry.serving - entry.removed).toBeLessThanOrEqual(entry.desired);
    }
    expect(summary.peakTasks).toBe(5);
  });

  it("keeps the extra tasks for fifteen quiet minutes before letting them go", () => {
    // The load is back at its base in minute 70; below 90 % of the target since minute 62.
    expect(summary.scaleIns).toEqual([{ minute: 76, removed: 3 }]);
    expect(timeline.at(-1)).toMatchObject({ serving: 2, desired: 2 });
  });

  it("does not scale in again inside the cooldown", () => {
    const sawtooth = [
      ...Array.from({ length: 5 }, () => 3000),
      ...Array.from({ length: 40 }, () => 1500),
      ...Array.from({ length: 40 }, () => 600),
    ];
    const ins = summarize(
      simulate(sawtooth, { ...POLICY, scaleInCooldown: 30 }, { ...MODEL, inAfter: 3 }),
      MODEL,
    ).scaleIns.map((entry) => entry.minute);
    expect(ins).toHaveLength(2);
    expect((ins[1] ?? 0) - (ins[0] ?? 0)).toBeGreaterThanOrEqual(30);
  });

  it("stays put when the ceiling is reached, and counts what could not be served", () => {
    const flood = Array.from({ length: 30 }, () => 9000);
    const result = summarize(simulate(flood, POLICY, MODEL), MODEL);
    expect(result.peakTasks).toBe(POLICY.maxTasks);
    expect(simulate(flood, POLICY, MODEL).at(-1)?.overCapacity).toBe(9000 - 6 * 900);
  });
});

describe("what scale-in does to the requests a task is holding", () => {
  const stop = { shutdownDeadline: timing.shutdownDeadline, stopTimeout: timing.stopTimeout };
  // Mostly quick requests, and one in five that takes eight seconds.
  const durations = [0.2, 0.2, 0.5, 1, 8];

  it("finds a busy task in the middle of several requests", () => {
    expect(inFlightAt(600, durations)).toHaveLength(20);
    expect(inFlightAt(120, durations)).toEqual([6, 3.5, 1]);
    expect(inFlightAt(0, durations)).toEqual([]);
  });

  it("answers all of them when the deregistration delay covers the longest request", () => {
    const holding = inFlightAt(600, durations);
    expect(
      stopOutcome(
        holding,
        { ...stop, deregistrationDelay: timing.deregistrationDelay },
        "deregister-first",
      ),
    ).toEqual({ answered: 20, cut: 0 });
  });

  it("cuts every one of them when there is no delay", () => {
    const holding = inFlightAt(600, durations);
    expect(stopOutcome(holding, { ...stop, deregistrationDelay: 0 }, "deregister-first")).toEqual({
      answered: 0,
      cut: 20,
    });
  });

  it("cuts the slow ones when the delay is shorter than they are", () => {
    const holding = inFlightAt(600, durations);
    const outcome = stopOutcome(holding, { ...stop, deregistrationDelay: 5 }, "deregister-first");
    expect(outcome.cut).toBe(holding.filter((left) => left > 5).length);
    expect(outcome.cut).toBeGreaterThan(0);
  });

  it("pins the invariant: with the deployed durations, no request within its expected time is cut", () => {
    for (const perMinute of [60, 300, 600, 900]) {
      const holding = inFlightAt(perMinute, [timing.longestRequest]);
      for (const order of ["deregister-first", "signal-at-once"] as const) {
        expect(
          stopOutcome(holding, { ...stop, deregistrationDelay: timing.deregistrationDelay }, order)
            .cut,
        ).toBe(0);
      }
    }
  });

  it("shows why the server's own shutdown matters when the signal comes first", () => {
    const holding = inFlightAt(600, durations);
    // A process that exits on SIGTERM without waiting: the delay at the load balancer does not help.
    expect(
      stopOutcome(
        holding,
        { deregistrationDelay: timing.deregistrationDelay, shutdownDeadline: 0, stopTimeout: 30 },
        "signal-at-once",
      ),
    ).toEqual({ answered: 0, cut: 20 });
  });
});
