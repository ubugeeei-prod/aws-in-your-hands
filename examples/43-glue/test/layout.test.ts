import { describe, expect, it } from "vite-plus/test";

import {
  arrivalDays,
  CURATED_ROOT,
  curatedPrefix,
  planDays,
  RAW_ROOT,
  RETENTION_DAYS,
} from "../src/layout.ts";

const now = new Date("2026-10-13T01:00:00.000Z");

describe("where files are", () => {
  it("keeps the job's output out of its own input", () => {
    expect(CURATED_ROOT.startsWith(RAW_ROOT)).toBe(false);
    expect(RAW_ROOT.startsWith(CURATED_ROOT)).toBe(false);
  });

  it("gives a day one folder, the same on every run", () => {
    expect(curatedPrefix("2026-10-11")).toBe("requests_curated/dt=2026-10-11/");
    expect(curatedPrefix("2026-10-11")).toBe(curatedPrefix("2026-10-11"));
  });

  it("refuses a day that does not exist, before it becomes a key", () => {
    expect(() => curatedPrefix("2026-02-30")).toThrow();
    expect(() => curatedPrefix("2026-10-11/../x")).toThrow();
  });

  it("reads the folder before and the folder after, across a month's end", () => {
    expect(arrivalDays("2026-11-01")).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("the days a run builds", () => {
  it("builds yesterday, and the day before again, when nothing is asked", () => {
    expect(planDays("auto", now)).toEqual(["2026-10-11", "2026-10-12"]);
    expect(planDays("auto", new Date("2026-03-01T00:00:00.000Z"))).toEqual([
      "2026-02-27",
      "2026-02-28",
    ]);
  });

  it("takes named days once each, in order", () => {
    expect(planDays("2026-10-11,2026-10-09,2026-10-11", now)).toEqual(["2026-10-09", "2026-10-11"]);
  });

  it("refuses anything that is not a day", () => {
    expect(() => planDays("yesterday", now)).toThrow();
    expect(() => planDays("2026-10-11,", now)).toThrow();
  });

  it("refuses a day whose raw files may have expired", () => {
    // Raw files are kept 90 days, and a day needs the folder before it.
    expect(RETENTION_DAYS.raw).toBe(90);
    expect(planDays("2026-07-17", now)).toEqual(["2026-07-17"]);
    expect(() => planDays("2026-07-16", now)).toThrow(/2026-07-17/);
  });
});
