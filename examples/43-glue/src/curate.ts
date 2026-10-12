import type { RequestRecord } from "@aih/example-26-analytics/src/record.ts";

// #region curate
/**
 * What the job writes for one day, given every record it read. This function is
 * the specification; glue/curate.py is written to do the same in Spark.
 *
 * A record belongs to the day it was answered (`at`, in UTC), whichever folder
 * it was filed in. Records with the same `event_id` are one record. The order
 * of the result means nothing: Spark promises none.
 */
export function curate(records: readonly RequestRecord[], day: string): RequestRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (record.at.slice(0, 10) !== day || seen.has(record.event_id)) {
      return false;
    }
    seen.add(record.event_id);
    return true;
  });
}
// #endregion curate
