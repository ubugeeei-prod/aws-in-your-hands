import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { requestRecordSchema } from "@aih/example-26-analytics/src/record.ts";
import { sampleRecords } from "@aih/example-26-analytics/src/sample.ts";

import { evaluate, renderRule, renderRuleset, type Row, type Rule, RULES } from "../src/quality.ts";

const [record] = sampleRecords(1, "2026-10-10");
if (record === undefined) {
  throw new Error("sampleRecords returned nothing");
}
const failed = (rules: readonly Rule[], rows: readonly Row[]) =>
  evaluate(rules, rows)
    .filter(({ outcome }) => outcome === "Failed")
    .map(({ rule }) => rule);

describe("the ruleset as DQDL", () => {
  it("is the document the job is given", () => {
    expect(renderRuleset()).toBe(
      [
        "Rules = [",
        '    IsComplete "event_id",',
        '    IsUnique "event_id",',
        '    IsComplete "at",',
        '    ColumnValues "v" = 1,',
        '    ColumnValues "route" in ["/health", "/notes", "/notes/:id", "other"],',
        '    ColumnValues "status" between 99 and 600,',
        '    ColumnValues "duration_ms" >= 0',
        "]",
      ].join("\n"),
    );
  });

  it("refuses a value that would close the string it is written in", () => {
    expect(() =>
      renderRule({ type: "ColumnValues", column: "route", is: { op: "in", values: ['a"] , x'] } }),
    ).toThrow();
  });
});

describe("the rules, as this chapter reads the DQDL reference", () => {
  it("accepts exactly the status codes chapter 26's schema accepts", () => {
    // `between 99 and 600` leaves out 99 and 600: the reference calls the range exclusive.
    for (const status of [99, 100, 599, 600]) {
      const row = { ...record, status };
      expect(failed(RULES, [row]).length === 0).toBe(v.is(requestRecordSchema, row));
    }
  });

  it("fails a column of values when one of them is null", () => {
    expect(failed(RULES, [{ ...record, status: null }])).toEqual([
      'ColumnValues "status" between 99 and 600',
    ]);
    expect(failed(RULES, [{ ...record, event_id: null }])).toEqual(['IsComplete "event_id"']);
  });

  it("fails the whole day for one bad row among good ones", () => {
    const rows = [record, { ...record, event_id: "another", route: "/admin" }];
    expect(failed(RULES, rows)).toEqual([
      'ColumnValues "route" in ["/health", "/notes", "/notes/:id", "other"]',
    ]);
  });

  it("notices the same event twice", () => {
    expect(failed(RULES, [record, record])).toEqual(['IsUnique "event_id"']);
  });

  it("leaves the nullable columns alone", () => {
    expect(failed(RULES, [{ ...record, action: null, note_id: null }])).toEqual([]);
  });
});
