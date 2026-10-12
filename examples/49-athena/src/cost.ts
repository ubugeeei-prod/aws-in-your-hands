// Quantities for the pricing scenarios in data/fragments/49.json. Prices are
// not here: they come from the AWS Price List through tools/src/pricing.

import { athenaBilledTb } from "@aih/example-26-analytics/src/cost-inputs.ts";

// #region scan
/**
 * Bytes one query reads from a partitioned table: the folders it names, and of
 * each file the share its columns take. A row format has no such share: 1.
 */
export function scannedBytes(input: {
  partitions: number;
  bytesPerPartition: number;
  columnShare?: number;
}): number {
  const share = input.columnShare ?? 1;
  if (share < 0 || share > 1) {
    throw new Error(`A share is between 0 and 1: ${share}`);
  }
  return Math.ceil(input.partitions * input.bytesPerPartition * share);
}
// #endregion scan

// #region cost
/** What one query costs at `usdPerTb`, with the megabyte rounding and the 10 MB floor. */
export const queryCostUsd = (bytes: number, usdPerTb: number): number =>
  athenaBilledTb(bytes) * usdPerTb;

/**
 * Terabytes billed for `queries` queries that each want `bytes`, in a workgroup
 * that cancels a query at `limitBytes`. A cancelled query is billed for what it
 * read, taken here as the limit itself: how far past it a query gets is not documented.
 */
export const monthlyTb = (input: { bytes: number; queries: number; limitBytes?: number }): number =>
  athenaBilledTb(Math.min(input.bytes, input.limitBytes ?? Infinity), input.queries);
// #endregion cost

// #region workload
// Chapter 26's `analytics:sizes`: 5,000 sample records written both ways on a laptop.
const SAMPLE = { records: 5000, gzipJsonBytes: 293_422, parquetAtAndStatusBytes: 31_922 } as const;

/** The table the scenarios ask about: a million requests a day, kept for a year. */
export const WORKLOAD = {
  recordsPerDay: 1_000_000,
  days: 365,
  gzipJsonBytesPerRecord: SAMPLE.gzipJsonBytes / SAMPLE.records,
  // What a query that reads only `at` and `status` takes from a Parquet file.
  parquetTwoColumnBytesPerRecord: SAMPLE.parquetAtAndStatusBytes / SAMPLE.records,
} as const;

export const dayOfGzipJson = (): number =>
  Math.ceil(WORKLOAD.recordsPerDay * WORKLOAD.gzipJsonBytesPerRecord);
export const dayOfTwoParquetColumns = (): number =>
  Math.ceil(WORKLOAD.recordsPerDay * WORKLOAD.parquetTwoColumnBytesPerRecord);
// #endregion workload
