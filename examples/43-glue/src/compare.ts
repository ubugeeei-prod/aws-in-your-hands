import { isDeepStrictEqual } from "node:util";

import type { RequestRecord } from "@aih/example-26-analytics/src/record.ts";

// #region compare
export type Difference = {
  /** In the specification's result, absent from the job's. */
  missing: string[];
  /** Written by the job, absent from the specification's result. */
  unexpected: string[];
  /** Written more than once. */
  doubled: string[];
  /** Present on both sides with different values. */
  changed: string[];
};

/** How the rows a job wrote differ from the rows the specification gives. By `event_id`; order is ignored. */
export function difference(
  expected: readonly RequestRecord[],
  actual: readonly RequestRecord[],
): Difference {
  const wanted = new Map(expected.map((row) => [row.event_id, row]));
  const seen = new Set<string>();
  const result: Difference = { missing: [], unexpected: [], doubled: [], changed: [] };
  for (const row of actual) {
    const match = wanted.get(row.event_id);
    if (seen.has(row.event_id)) {
      result.doubled.push(row.event_id);
    } else if (match === undefined) {
      result.unexpected.push(row.event_id);
    } else if (!isDeepStrictEqual(match, row)) {
      result.changed.push(row.event_id);
    }
    seen.add(row.event_id);
  }
  result.missing = [...wanted.keys()].filter((id) => !seen.has(id));
  return result;
}

export const identical = (found: Difference): boolean =>
  Object.values(found).every((ids) => ids.length === 0);
// #endregion compare
