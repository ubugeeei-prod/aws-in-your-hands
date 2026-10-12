import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  bucket,
  defaultFlags,
  flagsSchema,
  inRollout,
  seesNoteStats,
  writesAreStopped,
} from "../src/flags/evaluate.ts";

const subjects = Array.from({ length: 10_000 }, (_, index) => `user-${index}`);

describe("the flags a build reads", () => {
  it("is everything off when nothing could be read", () => {
    expect(defaultFlags).toEqual({
      readOnly: { enabled: false },
      noteStats: { enabled: false, rolloutPercent: 100 },
    });
    expect(writesAreStopped(defaultFlags)).toBe(false);
    expect(seesNoteStats(defaultFlags, "user-1")).toBe(false);
  });

  it("takes the default for a flag an older configuration does not have", () => {
    expect(v.parse(flagsSchema, { readOnly: { enabled: true } })).toEqual({
      readOnly: { enabled: true },
      noteStats: { enabled: false, rolloutPercent: 100 },
    });
  });

  it("ignores a flag a newer configuration has and this build does not know", () => {
    expect(
      v.parse(flagsSchema, { readOnly: { enabled: false }, darkMode: { enabled: true } }),
    ).toEqual(defaultFlags);
  });

  it("refuses what is not a map of flags, so that garbage does not read as all defaults", () => {
    for (const garbage of [
      [],
      null,
      "ok",
      1,
      { readOnly: true },
      { noteStats: { enabled: "yes" } },
    ]) {
      expect(v.safeParse(flagsSchema, garbage).success).toBe(false);
    }
    expect(
      v.safeParse(flagsSchema, { noteStats: { enabled: true, rolloutPercent: 101 } }).success,
    ).toBe(false);
  });
});

describe("a percentage rollout", () => {
  it("gives the same subject the same answer every time", () => {
    expect(bucket("noteStats", "user-1")).toBe(bucket("noteStats", "user-1"));
    expect(inRollout("noteStats", 10, "user-1")).toBe(inRollout("noteStats", 10, "user-1"));
  });

  it("never takes the feature away from someone when the percentage grows", () => {
    let previous = new Set<string>();
    for (const percent of [0, 1, 10, 25, 50, 99, 100]) {
      const current = new Set(
        subjects.filter((subject) => inRollout("noteStats", percent, subject)),
      );
      expect([...previous].every((subject) => current.has(subject))).toBe(true);
      previous = current;
    }
    expect(previous.size).toBe(subjects.length);
  });

  it("lands close to the percentage over ten thousand subjects", () => {
    const inside = subjects.filter((subject) => inRollout("noteStats", 10, subject)).length;
    expect(inside).toBeGreaterThan(900);
    expect(inside).toBeLessThan(1100);
    expect(subjects.filter((subject) => inRollout("noteStats", 0, subject))).toEqual([]);
  });

  it("does not pick the same first 10% for every flag", () => {
    const first = subjects.filter((subject) => inRollout("noteStats", 10, subject));
    const both = first.filter((subject) => inRollout("anotherFlag", 10, subject));
    expect(both.length).toBeLessThan(first.length / 2);
  });

  it("leaves a caller without an ID out until the rollout is complete", () => {
    expect(inRollout("noteStats", 99, undefined)).toBe(false);
    expect(inRollout("noteStats", 100, undefined)).toBe(true);
  });

  it("needs the flag on as well as the subject inside", () => {
    const inside = subjects.find((subject) => inRollout("noteStats", 10, subject)) ?? "";
    const on = v.parse(flagsSchema, { noteStats: { enabled: true, rolloutPercent: 10 } });
    const off = v.parse(flagsSchema, { noteStats: { enabled: false } });
    expect(seesNoteStats(on, inside)).toBe(true);
    expect(seesNoteStats(off, inside)).toBe(false);
  });
});
