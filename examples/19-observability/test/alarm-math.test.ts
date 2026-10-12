import { describe, expect, it } from "vite-plus/test";

import { alarmState, errorRatePoint, errorRateRule, type MinuteCounts } from "../src/alarm-math.ts";

const minutes = (counts: MinuteCounts[]) => counts.map((minute) => errorRatePoint(minute));
const quiet: MinuteCounts = { requests: null, errors: null };

describe("the 5xx rate for one minute", () => {
  it("is a percentage of the requests", () => {
    expect(errorRatePoint({ requests: 200, errors: 10 })).toBe(5);
    expect(errorRatePoint({ requests: 200, errors: null })).toBe(0);
  });

  it("is 0 when too few requests arrived to call it a rate", () => {
    // One failure out of two would be "50%".
    expect(errorRatePoint({ requests: 2, errors: 1 })).toBe(0);
    expect(errorRatePoint({ requests: 19, errors: 19 })).toBe(0);
    expect(errorRatePoint({ requests: 20, errors: 20 })).toBe(100);
  });

  it("has no data point for a minute without requests", () => {
    expect(errorRatePoint(quiet)).toBeNull();
  });
});

describe("the 5xx rate alarm", () => {
  const failing: MinuteCounts = { requests: 100, errors: 30 };
  const healthy: MinuteCounts = { requests: 100, errors: 1 };

  it("fires after three bad minutes out of five, not after one", () => {
    expect(alarmState(minutes([healthy, healthy, healthy, healthy, failing]), errorRateRule)).toBe(
      "OK",
    );
    expect(alarmState(minutes([healthy, failing, healthy, failing, healthy]), errorRateRule)).toBe(
      "OK",
    );
    expect(alarmState(minutes([failing, healthy, failing, healthy, failing]), errorRateRule)).toBe(
      "ALARM",
    );
  });

  it("does not fire at exactly the threshold", () => {
    const atThreshold: MinuteCounts = { requests: 100, errors: errorRateRule.threshold };
    expect(
      alarmState(
        minutes([atThreshold, atThreshold, atThreshold, atThreshold, atThreshold]),
        errorRateRule,
      ),
    ).toBe("OK");
  });

  it("would page every quiet night if missing data counted as breaching", () => {
    const strict = { ...errorRateRule, treatMissingData: "breaching" } as const;
    expect(alarmState(minutes([quiet, quiet, quiet, quiet, quiet]), strict)).toBe("ALARM");
  });

  it("stays quiet through a night without requests, and through an outage nobody can reach", () => {
    // Requests that never arrive leave no data point either. Telling the two
    // apart takes a probe from outside (Synthetics), not this alarm.
    expect(alarmState(minutes([quiet, quiet, quiet, quiet, quiet]), errorRateRule)).toBe("OK");
  });

  it("recovers once the bad minutes leave the window", () => {
    const history = minutes([failing, failing, failing, healthy, healthy, healthy]);
    expect(alarmState(history.slice(0, 5), errorRateRule)).toBe("ALARM");
    expect(alarmState(history, errorRateRule)).toBe("OK");
  });
});
