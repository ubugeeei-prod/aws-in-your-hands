import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vite-plus/test";

import { type RequestRecord, toLine } from "@aih/example-26-analytics/src/record.ts";

import { identical, difference } from "../src/compare.ts";
import { curate } from "../src/curate.ts";
import { curatedPrefix, RAW_ROOT } from "../src/layout.ts";
import { JobModel, RECOMPUTE } from "../src/model.ts";
import { SAMPLE_DAYS, sampleLake } from "../src/sample.ts";

const { objects, records } = sampleLake();
const [first, second] = SAMPLE_DAYS;
const expected = (day: string, from: readonly RequestRecord[] = records) => curate(from, day);
const correct = (job: JobModel, day: string, from?: readonly RequestRecord[]) =>
  identical(difference(expected(day, from), job.rows(day)));

// The invariant: after a run that succeeded, a day holds every request answered
// that day exactly once, whatever happened to the runs before it.
describe("this chapter's job: named days, read whole, folders replaced", () => {
  it("writes each day once, in the day's own folder", () => {
    const job = new JobModel(RECOMPUTE);
    job.run(objects, { days: SAMPLE_DAYS });
    expect(correct(job, first) && correct(job, second)).toBe(true);
    expect([...job.target.keys()].map((key) => key.slice(0, key.lastIndexOf("/") + 1))).toEqual(
      SAMPLE_DAYS.map(curatedPrefix),
    );
  });

  it("leaves the same rows when it runs again", () => {
    const job = new JobModel(RECOMPUTE);
    job.run(objects, { days: SAMPLE_DAYS });
    job.run(objects, { days: SAMPLE_DAYS });
    expect(correct(job, first) && correct(job, second)).toBe(true);
    // One file per day still: the second run's file took the place of the first's.
    expect(job.target.size).toBe(2);
  });

  it("neither drops nor doubles a row when a run dies after writing and is run again", () => {
    const job = new JobModel(RECOMPUTE);
    expect(() => job.run(objects, { days: SAMPLE_DAYS, crash: "after-write" })).toThrow();
    job.run(objects, { days: SAMPLE_DAYS });
    expect(correct(job, first) && correct(job, second)).toBe(true);
  });

  it("leaves a day empty when a run dies inside the overwrite, until the next run", () => {
    const job = new JobModel(RECOMPUTE);
    job.run(objects, { days: SAMPLE_DAYS });
    expect(() => job.run(objects, { days: SAMPLE_DAYS, crash: "after-delete" })).toThrow();
    // Spark deletes, then writes. A reader in between sees a day without requests.
    expect(job.rows(first)).toEqual([]);
    expect(correct(job, second)).toBe(true);

    job.run(objects, { days: SAMPLE_DAYS });
    expect(correct(job, first) && correct(job, second)).toBe(true);
  });

  it("takes in a file that arrived after the day was first built", () => {
    const late = objects.at(-1);
    const job = new JobModel(RECOMPUTE);
    job.run(objects.slice(0, -1), { days: [first] });
    expect(job.rows(first)).toHaveLength(expected(first).length - 1);

    job.run(objects, { days: [first] });
    expect(late?.key.startsWith(`${RAW_ROOT}dt=${second}/`)).toBe(true);
    expect(correct(job, first)).toBe(true);
  });

  it("does not replace a day with nothing once its raw files are gone", () => {
    const job = new JobModel(RECOMPUTE);
    job.run(objects, { days: [first] });
    job.run([], { days: [first] });
    expect(correct(job, first)).toBe(true);
  });

  it("writes nothing for a day whose rows fail a rule, and keeps what was there", () => {
    const job = new JobModel(RECOMPUTE);
    job.run(objects, { days: [first] });
    const noClientErrors = [
      { type: "ColumnValues", column: "status", is: { op: "between", above: 99, below: 400 } },
    ] as const;
    expect(() => job.run(objects, { days: [first], rules: noClientErrors })).toThrow(
      /ColumnValues "status" between 99 and 400/,
    );
    expect(correct(job, first)).toBe(true);
  });
});

describe("with a job bookmark, appending", () => {
  const design = { bookmark: true, sink: "append" } as const;

  it("is right as long as every run succeeds and no record repeats across files", () => {
    const job = new JobModel(design);
    const half = Math.floor(objects.length / 2);
    job.run(objects.slice(0, half));
    job.run(objects);
    // Each file was read once. The rows are split over two files a day.
    const everything = [...job.rows(first), ...job.rows(second)];
    expect(new Set(everything.map((row) => row.event_id)).size).toBe(everything.length);
    expect(everything).toHaveLength(expected(first).length + expected(second).length);
  });

  it("doubles every row of a run that died between its write and job.commit()", () => {
    const job = new JobModel(design);
    expect(() => job.run(objects, { crash: "after-write" })).toThrow();
    job.run(objects);
    const found = difference(expected(first), job.rows(first));
    expect(found.doubled).toHaveLength(expected(first).length);
    expect(found.missing).toEqual([]);
  });

  it("doubles every row after the bookmark is reset, because the target is not tracked", () => {
    const job = new JobModel(design);
    job.run(objects);
    job.resetBookmark();
    job.run(objects);
    expect(difference(expected(second), job.rows(second)).doubled).toHaveLength(
      expected(second).length,
    );
  });

  it("keeps both copies of a record whose second copy came in a later file", () => {
    const [record] = records;
    if (record === undefined) {
      throw new Error("the sample is empty");
    }
    const retry = { key: `${RAW_ROOT}dt=${first}/retry.gz`, bytes: gzipSync(toLine(record)) };
    const job = new JobModel(design);
    job.run(objects);
    job.run([...objects, retry]);
    expect(difference(expected(first), job.rows(first)).doubled).toEqual([record.event_id]);

    // Reading the day whole removes it, whichever file it is in.
    const whole = new JobModel(RECOMPUTE);
    whole.run([...objects, retry], { days: [first] });
    expect(correct(whole, first)).toBe(true);
  });
});

describe("with a job bookmark, replacing", () => {
  it("drops the rows of every earlier run", () => {
    const job = new JobModel({ bookmark: true, sink: "replace" });
    const late = objects.slice(-1);
    job.run(objects.slice(0, -1));
    job.run(objects);
    // The second run read one new file, and put its one row in place of the day.
    expect(job.rows(first)).toHaveLength(1);
    expect(difference(expected(first), job.rows(first)).missing).toHaveLength(
      expected(first).length - 1,
    );
    expect(late).toHaveLength(1);
  });
});
