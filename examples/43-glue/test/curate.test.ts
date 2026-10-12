import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { scanPartitions } from "@aih/example-26-analytics/src/lake.ts";
import { requestRecordSchema } from "@aih/example-26-analytics/src/record.ts";

import { curate } from "../src/curate.ts";
import { arrivalDays } from "../src/layout.ts";
import { evaluate, RULES } from "../src/quality.ts";
import { SAMPLE_DAYS, sampleLake } from "../src/sample.ts";

const { objects, records } = sampleLake();
const [first, second] = SAMPLE_DAYS;
const read = (days: readonly string[]) => scanPartitions(objects, days).records;
const ids = (rows: readonly { event_id: string }[]) => rows.map((row) => row.event_id).toSorted();

describe("the sample", () => {
  it("holds records sent twice, and records filed under another day", () => {
    const all = read(arrivalDays(first).concat(arrivalDays(second)));
    expect(all.length).toBeGreaterThan(new Set(all.map((row) => row.event_id)).size);

    const filedUnderFirst = read([first]);
    expect(filedUnderFirst.some((row) => row.at.startsWith(second))).toBe(true);
    expect(read([second]).some((row) => row.at.startsWith(first))).toBe(true);
  });
});

describe("what the job writes for a day", () => {
  it("is every request answered that day, once", () => {
    for (const day of SAMPLE_DAYS) {
      const expected = records.filter((record) => record.at.startsWith(day));
      expect(ids(curate(read(arrivalDays(day)), day))).toEqual(ids(expected));
    }
  });

  it("does not depend on which folder a record arrived in", () => {
    const rows = curate(read(arrivalDays(first)), first);
    expect(rows.some((row) => row.at === `${first}T23:59:59.500Z`)).toBe(true);
    expect(rows.every((row) => row.at.startsWith(first))).toBe(true);
  });

  it("is short of rows when only the day's own folder is read", () => {
    const whole = curate(read(arrivalDays(first)), first);
    expect(curate(read([first]), first).length).toBeLessThan(whole.length);
    expect(curate(read([second]), second).length).toBeLessThan(
      curate(read(arrivalDays(second)), second).length,
    );
  });

  it("keeps a record as it was written", () => {
    for (const row of curate(read(arrivalDays(first)), first)) {
      expect(v.is(requestRecordSchema, row)).toBe(true);
    }
  });

  it("passes the rules the job checks before it writes", () => {
    for (const day of SAMPLE_DAYS) {
      const outcomes = evaluate(RULES, curate(read(arrivalDays(day)), day));
      expect(outcomes.filter(({ outcome }) => outcome === "Failed")).toEqual([]);
    }
  });
});
