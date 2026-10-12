import { describe, expect, it } from "vite-plus/test";

import { planFor } from "../src/shift/plan.ts";
import { runShift } from "../src/shift/run.ts";
import { FakeAlarms, FakeAlias, FakeClock } from "./fakes.ts";

function setup(planName = "Canary10Percent5Minutes", alias = new FakeAlias("3")) {
  const clock = new FakeClock();
  const alarms = new FakeAlarms();
  const lines: string[] = [];
  const run = (to = "4") =>
    runShift({
      alias,
      alarms,
      clock,
      plan: planFor(planName, 120),
      to,
      pollSeconds: 30,
      limits: { maxBlindSeconds: 90 },
      log: (line) => lines.push(`${clock.now() / 1000}s ${line}`),
    });
  return { alias, alarms, clock, lines, run };
}

const old = { version: "3", weights: {} };
const canary = { version: "3", weights: { "4": 0.1 } };
const promoted = { version: "4", weights: {} };

// The invariant: the alias only ever names the old version and the target, and once an
// alarm has been seen in ALARM the run ends with every request on the old version.
const onlyTwoVersions = (alias: FakeAlias) =>
  alias.history.every(
    (state) =>
      ["3", "4"].includes(state.version) &&
      Object.keys(state.weights).every((version) => version === "4"),
  );

describe("a shift that goes well", () => {
  it("gives the new version 10%, holds five minutes, then everything, then bakes", async () => {
    const { alias, lines, run } = setup();
    expect(await run()).toEqual({ outcome: "completed", from: "3", to: "4" });
    expect(alias.history).toEqual([old, canary, promoted]);
    expect(lines).toEqual(["0s 10% on version 4", "300s 100% on version 4"]);
  });

  it("walks every step of a linear plan in order", async () => {
    const { alias, clock, run } = setup("Linear10PercentEvery1Minute");
    expect((await run()).outcome).toBe("completed");
    expect(
      alias.history.map((state) => state.weights["4"] ?? (state.version === "4" ? 1 : 0)),
    ).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(clock.now() / 1000).toBe(9 * 60 + 120);
    expect(onlyTwoVersions(alias)).toBe(true);
  });

  it("does nothing when it is run again after it finished", async () => {
    const { alias, run } = setup();
    await run();
    const writes = alias.history.length;
    expect(await run()).toEqual({ outcome: "completed", from: "4", to: "4" });
    expect(alias.history).toHaveLength(writes);
  });
});

describe("a shift that meets an alarm", () => {
  it("takes the 10% back when the alarm fires during the canary", async () => {
    const { alias, alarms, clock, run } = setup();
    clock.onTick = (seconds) => {
      if (seconds === 90) {
        alarms.state = "ALARM";
      }
    };
    expect(await run()).toEqual({
      outcome: "rolled-back",
      from: "3",
      to: "4",
      reason: "in ALARM: api-5xx",
    });
    expect(alias.history).toEqual([old, canary, old]);
    // Noticed at the first poll after it fired, not at the end of the hold.
    expect(clock.now() / 1000).toBe(90);
  });

  it("points the alias back at the old version when the alarm fires during the bake", async () => {
    const { alias, alarms, clock, run } = setup();
    clock.onTick = (seconds) => {
      if (seconds === 360) {
        alarms.state = "ALARM";
      }
    };
    expect((await run()).outcome).toBe("rolled-back");
    expect(alias.history).toEqual([old, canary, promoted, old]);
  });

  it("does not start while an alarm is already firing, and changes nothing", async () => {
    const { alias, alarms, run } = setup();
    alarms.state = "ALARM";
    expect(await run()).toEqual({ outcome: "refused", reason: "already in ALARM: api-5xx" });
    expect(alias.history).toEqual([old]);
  });

  it("rides out a short spell without readings, and rolls back after a long one", async () => {
    const short = setup();
    short.clock.onTick = (seconds) => {
      short.alarms.unreadable = seconds >= 60 && seconds < 120;
    };
    expect((await short.run()).outcome).toBe("completed");

    const long = setup();
    long.clock.onTick = (seconds) => {
      long.alarms.unreadable = seconds >= 60;
    };
    expect(await long.run()).toEqual({
      outcome: "rolled-back",
      from: "3",
      to: "4",
      reason: "no alarm reading for 90 seconds",
    });
    expect(long.alias.current).toEqual(old);
  });

  it("still rolls back when the first attempt to write the rollback fails", async () => {
    const { alias, alarms, clock, run } = setup();
    clock.onTick = (seconds) => {
      if (seconds === 30) {
        alarms.state = "ALARM";
        alias.failNextWrite = "before";
      }
    };
    expect((await run()).outcome).toBe("rolled-back");
    expect(alias.current).toEqual(old);
  });
});

describe("a shift whose writes go wrong", () => {
  it("carries on when a write was applied and only its answer was lost", async () => {
    const { alias, run } = setup();
    alias.failNextWrite = "after";
    expect((await run()).outcome).toBe("completed");
    // The 10% was written once, not twice.
    expect(alias.history).toEqual([old, canary, promoted]);
  });

  it("sends the write again when it never arrived", async () => {
    const { alias, run } = setup();
    alias.failNextWrite = "before";
    expect((await run()).outcome).toBe("completed");
    expect(alias.history).toEqual([old, canary, promoted]);
  });

  it("stops without touching the alias when someone else changed it during the hold", async () => {
    const { alias, clock, run } = setup();
    const theirs = { version: "3", weights: { "4": 0.5 } };
    clock.onTick = (seconds) => {
      if (seconds === 60) {
        alias.changedByAnother(theirs);
      }
    };
    expect(await run()).toEqual({
      outcome: "abandoned",
      reason: "the alias was changed by someone else during the shift",
    });
    expect(alias.current).toEqual(theirs);
  });

  it("does not overwrite someone else's change even to roll back", async () => {
    const { alias, alarms, clock, run } = setup();
    const theirs = { version: "5", weights: {} };
    clock.onTick = (seconds) => {
      if (seconds === 60) {
        alias.changedByAnother(theirs);
        alarms.state = "ALARM";
      }
    };
    expect((await run()).outcome).toBe("abandoned");
    expect(alias.current).toEqual(theirs);
  });

  it("refuses to start on top of a shift to another version", async () => {
    const { alias, run } = setup("Canary10Percent5Minutes", new FakeAlias("3", { "5": 0.25 }));
    expect(await run()).toEqual({
      outcome: "refused",
      reason: "another shift is in progress: 25% on 5, the rest on 3",
    });
    expect(alias.history).toHaveLength(1);
  });
});

describe("a shift that was interrupted", () => {
  it("takes up at the share the earlier run reached, without dropping to zero first", async () => {
    const { alias, lines, run } = setup(
      "Linear10PercentEvery1Minute",
      new FakeAlias("3", { "4": 0.4 }),
    );
    expect((await run()).outcome).toBe("completed");
    const shares = alias.history.map(
      (state) => state.weights["4"] ?? (state.version === "4" ? 1 : 0),
    );
    expect(shares).toEqual([0.4, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(lines[0]).toBe("0s resuming at 40%");
  });

  it("can be rolled back by a later run that finds an alarm firing", async () => {
    // The first run died at 10%. Nothing watches the alias until someone runs the script again.
    const { alias, alarms, clock, run } = setup(
      "Canary10Percent5Minutes",
      new FakeAlias("3", { "4": 0.1 }),
    );
    clock.onTick = () => {
      alarms.state = "ALARM";
    };
    expect((await run()).outcome).toBe("rolled-back");
    expect(alias.current).toEqual(old);
  });
});
