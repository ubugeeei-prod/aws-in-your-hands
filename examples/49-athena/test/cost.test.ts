import { describe, expect, it } from "vite-plus/test";

import {
  dayOfGzipJson,
  dayOfTwoParquetColumns,
  monthlyTb,
  queryCostUsd,
  scannedBytes,
  WORKLOAD,
} from "../src/cost.ts";

const USD_PER_TB = 5;
const MB = 1024 ** 2;
const GIB = 1024 ** 3;

describe("what a query scans", () => {
  it("is the folders it names times what each holds, for a row format", () => {
    expect(scannedBytes({ partitions: 3, bytesPerPartition: 2 * GIB })).toBe(6 * GIB);
  });

  it("shrinks with the share of the columns it reads, for a columnar format", () => {
    expect(scannedBytes({ partitions: 3, bytesPerPartition: 2 * GIB, columnShare: 0.1 })).toBe(
      Math.ceil(0.6 * GIB),
    );
    expect(() => scannedBytes({ partitions: 1, bytesPerPartition: 1, columnShare: 1.5 })).toThrow();
  });
});

describe("what a query costs", () => {
  it("never bills under 10 MB, and rounds up to a megabyte above it", () => {
    expect(queryCostUsd(1, USD_PER_TB)).toBe(queryCostUsd(10 * MB, USD_PER_TB));
    expect(queryCostUsd(10 * MB + 1, USD_PER_TB)).toBe(queryCostUsd(11 * MB, USD_PER_TB));
  });

  it("is USD 5 for a terabyte and about half a cent at the 1 GiB limit", () => {
    expect(queryCostUsd(1024 ** 4, USD_PER_TB)).toBe(5);
    expect(queryCostUsd(GIB, USD_PER_TB)).toBeCloseTo(0.0048828125, 12);
  });
});

// The quantities in data/fragments/49.json. A change here means the fragment must change too.
describe("the scenarios", () => {
  const day = dayOfGzipJson();
  const year = scannedBytes({ partitions: WORKLOAD.days, bytesPerPartition: day });

  it("sizes a day and a year of the table", () => {
    expect(day).toBe(58_684_400);
    expect(year).toBe(21_419_806_000);
    expect(dayOfTwoParquetColumns()).toBe(6_384_400);
  });

  it("a query that names its day: 56 MB billed, 1,000 of them 0.0534 TB", () => {
    expect(queryCostUsd(day, USD_PER_TB)).toBeCloseTo(0.000267, 6);
    expect(monthlyTb({ bytes: day, queries: 1000 })).toBeCloseTo(0.053406, 6);
  });

  it("the same query without the day reads the year, LIMIT or not: 365 times the bytes", () => {
    expect(queryCostUsd(year, USD_PER_TB)).toBeCloseTo(0.097408, 6);
    expect(monthlyTb({ bytes: year, queries: 1000 })).toBeCloseTo(19.481659, 6);
  });

  it("the workgroup's limit turns that into 1 GiB a query, and no answer", () => {
    expect(monthlyTb({ bytes: year, queries: 1000, limitBytes: GIB })).toBeCloseTo(0.976563, 6);
    // A query under the limit is not touched by it.
    expect(monthlyTb({ bytes: day, queries: 1000, limitBytes: GIB })).toBe(
      monthlyTb({ bytes: day, queries: 1000 }),
    );
  });

  it("two Parquet columns of a day fall under the 10 MB floor", () => {
    expect(dayOfTwoParquetColumns()).toBeLessThan(10 * MB);
    expect(monthlyTb({ bytes: dayOfTwoParquetColumns(), queries: 1000 })).toBeCloseTo(0.009537, 6);
  });
});
