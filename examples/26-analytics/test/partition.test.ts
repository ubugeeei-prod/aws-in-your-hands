import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  addDays,
  daysBetween,
  daySchema,
  evaluatePrefix,
  FIREHOSE_ERROR_PREFIX,
  firehosePrefix,
  partitionOf,
  projectionParameters,
} from "../src/partition.ts";

describe("the prefix Firehose is given", () => {
  it("files an object under the UTC day its oldest record arrived", () => {
    // 08:30 on the 13th in Tokyo is still the 12th in UTC.
    const arrival = new Date("2026-10-13T08:30:00+09:00");
    expect(evaluatePrefix(firehosePrefix("json"), arrival)).toBe("requests_json/dt=2026-10-12/");
    expect(evaluatePrefix(firehosePrefix("parquet"), arrival)).toBe(
      "requests_parquet/dt=2026-10-12/",
    );
  });

  it("sends failed records elsewhere, by the kind of failure", () => {
    expect(evaluatePrefix(FIREHOSE_ERROR_PREFIX, new Date("2026-10-12T00:00:00Z"))).toBe(
      "errors/format-conversion-failed/2026-10-12/",
    );
    // Firehose requires this expression in an error prefix, and forbids it in the other.
    expect(FIREHOSE_ERROR_PREFIX).toContain("!{firehose:error-output-type}");
    expect(firehosePrefix("json")).not.toContain("!{firehose:");
  });

  it("refuses an expression the model does not know, instead of guessing", () => {
    expect(() => evaluatePrefix("x/!{timestamp:HH}/", new Date(0))).toThrow();
    expect(() => evaluatePrefix("x/!{partitionKeyFromQuery:owner}/", new Date(0))).toThrow();
  });
});

describe("the partitions Athena projects", () => {
  it("builds the same location Firehose writes to, for every format", () => {
    for (const format of ["json", "parquet"] as const) {
      const location = `s3://lake/requests_${format}/`;
      const template = projectionParameters(location)["storage.location.template"] ?? "";
      const written = `s3://lake/${evaluatePrefix(firehosePrefix(format), new Date("2026-10-12T23:59:59Z"))}`;
      expect(template.replace("${dt}", "2026-10-12")).toBe(written);
    }
  });

  it("projects one partition a day, from a fixed first day to the moment of the query", () => {
    expect(projectionParameters("s3://lake/requests_json/")).toMatchObject({
      "projection.enabled": "true",
      "projection.dt.type": "date",
      "projection.dt.format": "yyyy-MM-dd",
      "projection.dt.range": "2026-10-01,NOW",
      "projection.dt.interval": "1",
      "projection.dt.interval.unit": "DAYS",
    });
  });

  it("reads the partition back from a key, and ignores keys outside the table", () => {
    expect(partitionOf("requests_json/dt=2026-10-12/local-1.gz", "json")).toBe("2026-10-12");
    expect(partitionOf("requests_json/dt=2026-10-12/local-1.gz", "parquet")).toBeUndefined();
    expect(partitionOf("errors/format-conversion-failed/2026-10-12/x", "json")).toBeUndefined();
    expect(partitionOf("athena-results/dt=2026-10-12/x.csv", "json")).toBeUndefined();
  });
});

describe("days", () => {
  it("accepts only days that exist", () => {
    expect(v.safeParse(daySchema, "2028-02-29").success).toBe(true);
    for (const day of ["2026-02-30", "2026-13-01", "2026-1-1", "2026-10-12T00:00:00Z", ""]) {
      expect(v.safeParse(daySchema, day).success).toBe(false);
    }
  });

  it("steps over month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});
