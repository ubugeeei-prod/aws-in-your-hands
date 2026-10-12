import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { COLUMNS, parseLines, requestRecordSchema, toLine } from "../src/record.ts";
import { sampleRecords } from "../src/sample.ts";

const [record] = sampleRecords(1, "2026-10-12");
if (record === undefined) {
  throw new Error("no sample record");
}

describe("the record", () => {
  it("has the columns of the Glue table, in the same order", () => {
    expect(COLUMNS.map((column) => column.name)).toEqual(Object.keys(requestRecordSchema.entries));
  });

  it("uses only lower-case names, as Athena spells columns", () => {
    for (const { name } of COLUMNS) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("refuses a field nobody listed", () => {
    expect(v.safeParse(requestRecordSchema, { ...record, title: "shopping" }).success).toBe(false);
    expect(v.safeParse(requestRecordSchema, { ...record, route: "/notes/abc123" }).success).toBe(
      false,
    );
  });

  it("refuses a timestamp whose text order is not its time order", () => {
    for (const at of [
      "2026-10-12T09:00:00Z",
      "2026-10-12T18:00:00.000+09:00",
      "2026-02-30T00:00:00.000Z",
    ]) {
      expect(v.safeParse(requestRecordSchema, { ...record, at }).success).toBe(false);
    }
  });
});

describe("the line sent to Firehose", () => {
  it("is one JSON object and exactly one newline, at the end", () => {
    const line = toLine(record);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.indexOf("\n")).toBe(line.length - 1);
    expect(JSON.parse(line)).toEqual(record);
  });

  it("can be read back after Firehose joins lines end to end", () => {
    const records = sampleRecords(3, "2026-10-12");
    expect(parseLines(records.map(toLine).join(""))).toEqual(records);
  });

  it("refuses to write a record that does not fit the schema", () => {
    expect(() => toLine({ ...record, status: 99 })).toThrow();
  });

  it("stays far below the 5 KB step Firehose bills in", () => {
    const sizes = sampleRecords(500, "2026-10-12").map((each) => Buffer.byteLength(toLine(each)));
    expect(Math.max(...sizes)).toBeLessThan(300);
  });
});
