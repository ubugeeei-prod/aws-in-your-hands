import * as v from "valibot";

import { addDays, dayOf, daySchema, tableRoot } from "@aih/example-26-analytics/src/partition.ts";

// #region layout
/** Where chapter 26's Firehose stream writes: gzip JSON lines, filed by the day they arrived. */
export const RAW_ROOT = tableRoot("json");
/** Where the job writes: Parquet, filed by the day the request was answered. */
export const CURATED_ROOT = "requests_curated/";

// Days each prefix is kept. The curated files outlive what they were made from.
export const RETENTION_DAYS = { raw: 90, curated: 365 } as const;

/**
 * The raw folders that can hold a record of `day`. An object is filed under the
 * day its oldest record arrived, which is the day before or after for a record
 * near midnight.
 */
export const arrivalDays = (day: string): string[] =>
  [-1, 0, 1].map((offset) => addDays(day, offset));

/** The one folder a run replaces for `day`. */
export const curatedPrefix = (day: string): string =>
  `${CURATED_ROOT}dt=${v.parse(daySchema, day)}/`;
// #endregion layout

// #region plan
/**
 * The days a run computes. "auto" is the two days before today in UTC: yesterday,
 * and the day before once more, now that its late records have arrived.
 */
export function planDays(argument: string, now: Date): string[] {
  const today = dayOf(now);
  if (argument === "auto") {
    return [addDays(today, -2), addDays(today, -1)];
  }
  const days = [...new Set(argument.split(","))].map((day) => v.parse(daySchema, day)).toSorted();
  // A day is rebuilt from three raw folders. Once the first of them has expired,
  // a rebuild would replace a complete day with a partial one.
  const oldest = addDays(today, -(RETENTION_DAYS.raw - 2));
  const expired = days.filter((day) => day < oldest);
  if (expired.length > 0) {
    throw new Error(
      `The raw files of ${expired.join(", ")} may have expired. The oldest day that can be rebuilt is ${oldest}.`,
    );
  }
  return days;
}
// #endregion plan
