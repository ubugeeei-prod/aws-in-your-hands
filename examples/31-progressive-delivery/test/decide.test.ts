import { describe, expect, it } from "vite-plus/test";

import { type AlarmState, decide, mayStart, type Observation } from "../src/shift/decide.ts";
import { planFor } from "../src/shift/plan.ts";

const plan = planFor("Canary10Percent5Minutes", 120);
const limits = { maxBlindSeconds: 180 };
const seen = (...states: AlarmState[]): Observation => ({
  kind: "alarms",
  alarms: states.map((state, index) => ({ name: `alarm-${index}`, state })),
});
const at = (step: number, blindSince: number | null = null) => ({
  step,
  stepStartedAt: 0,
  blindSince,
});
const seconds = (count: number) => count * 1000;

describe("decide", () => {
  it("waits while the step is still being watched", () => {
    expect(decide(plan, at(0), seen("OK", "OK"), seconds(299), limits).decision).toEqual({
      action: "wait",
    });
  });

  it("advances once the hold is over and every alarm says OK", () => {
    expect(decide(plan, at(0), seen("OK", "OK"), seconds(300), limits).decision).toEqual({
      action: "advance",
      toStep: 1,
    });
  });

  it("completes only after the last step has been watched for the bake time", () => {
    expect(decide(plan, at(1), seen("OK"), seconds(119), limits).decision.action).toBe("wait");
    expect(decide(plan, at(1), seen("OK"), seconds(120), limits).decision.action).toBe("complete");
  });

  it("rolls back on one alarm in ALARM, whatever the others say and however long it has been", () => {
    for (const now of [0, seconds(10), seconds(10_000)]) {
      expect(decide(plan, at(0), seen("OK", "ALARM"), now, limits).decision).toEqual({
        action: "rollback",
        reason: "in ALARM: alarm-1",
      });
    }
    // Also during the bake, when the new version already has everything.
    expect(decide(plan, at(1), seen("ALARM"), seconds(1), limits).decision.action).toBe("rollback");
  });

  it("does not advance on INSUFFICIENT_DATA, on a failed poll, or on no alarms at all", () => {
    for (const observation of [
      seen("OK", "INSUFFICIENT_DATA"),
      { kind: "unreadable" },
      seen(),
    ] as const) {
      const result = decide(plan, at(0), observation, seconds(900), limits);
      expect(result.decision).toEqual({ action: "wait" });
      expect(result.state.blindSince).toBe(seconds(900));
    }
  });

  it("gives up and rolls back when the alarms have vouched for nothing for too long", () => {
    const blind = at(0, seconds(100));
    expect(decide(plan, blind, { kind: "unreadable" }, seconds(279), limits).decision.action).toBe(
      "wait",
    );
    expect(decide(plan, blind, { kind: "unreadable" }, seconds(280), limits).decision).toEqual({
      action: "rollback",
      reason: "no alarm reading for 180 seconds",
    });
  });

  it("forgets a blind spell once every alarm says OK again", () => {
    const result = decide(plan, at(0, seconds(100)), seen("OK"), seconds(150), limits);
    expect(result.state.blindSince).toBeNull();
  });
});

describe("mayStart", () => {
  it("refuses to start under a firing alarm, without alarms, or without a reading", () => {
    expect(mayStart(seen("OK", "INSUFFICIENT_DATA"))).toEqual({ ok: true });
    expect(mayStart(seen("OK", "ALARM"))).toEqual({
      ok: false,
      reason: "already in ALARM: alarm-1",
    });
    expect(mayStart(seen()).ok).toBe(false);
    expect(mayStart({ kind: "unreadable" }).ok).toBe(false);
  });
});
