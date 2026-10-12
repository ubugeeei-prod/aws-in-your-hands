import { describe, expect, it } from "vite-plus/test";

import { ceilings, type Limits } from "../src/ceilings.ts";

// The documented defaults, and this chapter's stack as it is deployed.
const defaults: Limits = {
  accountRequestsPerSecond: 10_000,
  stageRequestsPerSecond: 10,
  accountConcurrency: 1000,
  reservedConcurrency: undefined,
  tableReadUnitsPerSecond: 150,
  tableWriteUnitsPerSecond: 40,
};

describe("which limit refuses first", () => {
  it("is the stage throttle for this chapter's stack, by a wide margin", () => {
    const [first, second] = ceilings(defaults, {
      durationSeconds: 0.06,
      readUnits: 1,
      writeUnits: 0,
    });

    expect(first).toEqual({ limit: "stage throttle", requestsPerSecond: 10 });
    expect(second).toEqual({ limit: "table read units", requestsPerSecond: 150 });
  });

  it("becomes the table once the stage throttle is raised past it", () => {
    const [first] = ceilings(
      { ...defaults, stageRequestsPerSecond: 500 },
      { durationSeconds: 0.06, readUnits: 0, writeUnits: 1 },
    );

    expect(first).toEqual({ limit: "table write units", requestsPerSecond: 40 });
  });

  it("becomes concurrency when requests are slow: 5 at a time, 2 seconds each", () => {
    const [first] = ceilings(
      { ...defaults, stageRequestsPerSecond: 500, reservedConcurrency: 5 },
      { durationSeconds: 2, readUnits: 0, writeUnits: 0 },
    );

    expect(first).toEqual({ limit: "reserved concurrency", requestsPerSecond: 2.5 });
  });

  it("caps a fast function at ten requests a second per execution environment", () => {
    const lambda = ceilings(
      { ...defaults, reservedConcurrency: 5 },
      { durationSeconds: 0.01, readUnits: 0, writeUnits: 0 },
    ).find((ceiling) => ceiling.limit === "reserved concurrency");

    // 5 / 0.01 would be 500.
    expect(lambda?.requestsPerSecond).toBe(50);
  });

  it("shows the mismatch the Lambda documentation warns about: 10,000 in, 1,000 at a time", () => {
    const wideOpen = ceilings(
      { ...defaults, stageRequestsPerSecond: 10_000 },
      { durationSeconds: 0.5, readUnits: 0, writeUnits: 0 },
    );

    expect(wideOpen[0]).toEqual({ limit: "account concurrency", requestsPerSecond: 2000 });
  });
});
