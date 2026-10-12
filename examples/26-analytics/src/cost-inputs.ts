// Quantities for the pricing scenarios in data/fragments/26.json. Prices are
// not here: they come from the AWS Price List through tools/src/pricing.

const KIB = 1024;
const GIB = 1024 ** 3;

// #region firehose
// Direct PUT is billed in 5 KB steps: a 200-byte record costs as much as a 5 KB one.
export const FIREHOSE_INCREMENT_BYTES = 5 * KIB;

/** GB that Firehose bills for `records` records of `bytesPerRecord` each. */
export function firehoseBilledGb(input: { records: number; bytesPerRecord: number }): number {
  const billed =
    Math.ceil(input.bytesPerRecord / FIREHOSE_INCREMENT_BYTES) * FIREHOSE_INCREMENT_BYTES;
  return (input.records * billed) / GIB;
}
// #endregion firehose

// #region athena
const MB = 1024 ** 2;
export const ATHENA_MINIMUM_BYTES = 10 * MB;

/** Bytes Athena bills for one query: rounded up to a megabyte, and never under 10 MB. */
export function athenaBilledBytes(scannedBytes: number): number {
  return Math.max(ATHENA_MINIMUM_BYTES, Math.ceil(scannedBytes / MB) * MB);
}

/** The same in terabytes, the unit the price is quoted in. */
export const athenaBilledTb = (scannedBytes: number, queries = 1): number =>
  (athenaBilledBytes(scannedBytes) * queries) / 1024 ** 4;
// #endregion athena

/** GB-months of storage for data that arrives at a steady rate and expires after `days`. */
export function storedGbMonths(input: { gbPerMonth: number; retentionDays: number }): number {
  return (input.gbPerMonth * input.retentionDays) / 30;
}
