import { describe, expect, it } from "vite-plus/test";

import {
  ATHENA_MINIMUM_BYTES,
  athenaBilledBytes,
  athenaBilledTb,
  firehoseBilledGb,
  storedGbMonths,
} from "../src/cost-inputs.ts";

describe("what Firehose bills", () => {
  it("counts a small record as a full 5 KB", () => {
    const small = firehoseBilledGb({ records: 1_000_000, bytesPerRecord: 210 });
    expect(small).toBeCloseTo(4.768, 3);
    expect(firehoseBilledGb({ records: 1_000_000, bytesPerRecord: 5120 })).toBe(small);
    expect(firehoseBilledGb({ records: 1_000_000, bytesPerRecord: 5121 })).toBe(small * 2);
  });
});

describe("what Athena bills", () => {
  it("never bills a query for less than 10 MB", () => {
    expect(athenaBilledBytes(0)).toBe(ATHENA_MINIMUM_BYTES);
    expect(athenaBilledBytes(300_000)).toBe(ATHENA_MINIMUM_BYTES);
    expect(athenaBilledBytes(10 * 1024 ** 2 + 1)).toBe(11 * 1024 ** 2);
  });

  it("adds up to terabytes over many queries", () => {
    // 1,000 small queries: 10 MB each, about 0.0095 TB.
    expect(athenaBilledTb(300_000, 1000)).toBeCloseTo(0.00954, 5);
  });
});

describe("what stays in the bucket", () => {
  it("levels off at the retention period", () => {
    expect(storedGbMonths({ gbPerMonth: 0.2, retentionDays: 90 })).toBeCloseTo(0.6, 10);
  });
});
