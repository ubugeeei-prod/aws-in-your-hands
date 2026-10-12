import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { utcTimestamp } from "../src/timestamp.ts";

const accepts = (value: unknown): boolean => v.safeParse(utcTimestamp, value).success;

describe("utcTimestamp", () => {
  it("accepts what toISOString() writes, with or without milliseconds", () => {
    expect(accepts(new Date(0).toISOString())).toBe(true);
    expect(accepts("2026-10-12T09:00:00Z")).toBe(true);
    expect(accepts("2024-02-29T23:59:59.999Z")).toBe(true);
  });

  it("refuses every other spelling of a time", () => {
    for (const value of [
      "2026-10-12T09:00:00+09:00",
      "2026-10-12 09:00:00Z",
      "2026-10-12T09:00Z",
      "2026-10-12",
      "2026-10-12T24:00:00Z",
      "2026-10-12T09:00:00.000z",
      1_760_000_000_000,
      null,
    ]) {
      expect(accepts(value)).toBe(false);
    }
  });

  it("refuses a day that does not exist", () => {
    for (const value of [
      "2026-02-30T00:00:00Z",
      "2026-02-29T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-04-31T00:00:00Z",
      "2026-00-10T00:00:00Z",
    ]) {
      expect(accepts(value)).toBe(false);
    }
  });
});
