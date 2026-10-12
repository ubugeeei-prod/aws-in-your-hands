import { describe, expect, it } from "vite-plus/test";

import { RELEASE_CALENDAR, supportStatus, upgradePath, type VersionDates } from "../src/support.ts";

const dates = (version: string): VersionDates => {
  const found = RELEASE_CALENDAR.find((entry) => entry.version === version);
  if (found === undefined) {
    throw new Error(`${version} is not in the calendar`);
  }
  return found;
};
const at = (date: string): Date => new Date(`${date}T00:00:00Z`);

describe("the support window of a Kubernetes version", () => {
  it("gives every version twelve months of extended support after standard support", () => {
    for (const entry of RELEASE_CALENDAR) {
      const [standard, extended] = [entry.endOfStandardSupport, entry.endOfExtendedSupport];
      expect(Number(extended.slice(0, 4)) - Number(standard.slice(0, 4)), entry.version).toBe(1);
      expect(extended.slice(4), entry.version).toBe(standard.slice(4));
    }
  });

  // #region status
  it("is standard until the day standard support ends", () => {
    expect(supportStatus(dates("1.37"), "STANDARD", at("2026-10-13"))).toEqual({
      phase: "standard",
      daysLeft: 414,
    });
    expect(supportStatus(dates("1.37"), "STANDARD", at("2027-11-30"))).toEqual({
      phase: "standard",
      daysLeft: 1,
    });
  });

  it("under STANDARD, is upgraded by EKS on that day and never billed for extended support", () => {
    expect(supportStatus(dates("1.37"), "STANDARD", at("2027-12-01"))).toEqual({
      phase: "auto-upgrade",
    });
  });

  it("under EXTENDED, the default, is billed at the higher rate for up to a year", () => {
    expect(supportStatus(dates("1.37"), "EXTENDED", at("2027-12-01"))).toEqual({
      phase: "extended",
      daysLeft: 366,
    });
    expect(supportStatus(dates("1.37"), "EXTENDED", at("2028-12-01"))).toEqual({
      phase: "auto-upgrade",
    });
  });

  it("says that 1.33 was already in extended support when this was written", () => {
    expect(supportStatus(dates("1.33"), "EXTENDED", at("2026-10-13")).phase).toBe("extended");
    expect(supportStatus(dates("1.34"), "EXTENDED", at("2026-10-13"))).toEqual({
      phase: "standard",
      daysLeft: 50,
    });
  });
  // #endregion status
});

describe("the way from one version to another", () => {
  it("passes through every minor version in between", () => {
    expect(upgradePath("1.34", "1.37")).toEqual(["1.35", "1.36", "1.37"]);
    expect(upgradePath("1.37", "1.37")).toEqual([]);
  });

  it("orders versions as numbers: 1.9 is older than 1.10", () => {
    expect(upgradePath("1.9", "1.10")).toEqual(["1.10"]);
  });

  it("refuses to go down, and refuses what is not a minor version", () => {
    expect(() => upgradePath("1.37", "1.36")).toThrow(/older/);
    expect(() => upgradePath("1.37.1", "1.38")).toThrow(/minor version/);
  });
});
