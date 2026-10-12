import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";

// #region record
// Chapter 08's check: UTC only, and a day that exists. The summary subtracts these.
const moment = v.nullable(utcTimestamp);
const count = v.nullable(v.pipe(v.number(), v.safeInteger(), v.minValue(0)));

// Every field starts as null and is filled in during the drill. A field that
// stays null is a step that did not happen, and the summary says so.
export const drillRecordSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  region: v.pipe(v.string(), v.minLength(1)),
  tableName: v.nullable(v.string()),
  restoredTableName: v.nullable(v.string()),
  bucketName: v.nullable(v.string()),
  timeline: v.object({
    /** The last write you know was good. Restoring to before this loses it. */
    lastGoodWriteAt: moment,
    accidentAt: moment,
    detectedAt: moment,
    /** The point given to RestoreTableToPointInTime. */
    tableRestorePoint: moment,
    /** The point given to the object restore. */
    objectRestorePoint: moment,
    restoreRequestedAt: moment,
    tableActiveAt: moment,
    objectsRestoredAt: moment,
    verifiedAt: moment,
    cutoverAt: moment,
    /** The deployed function read the restored data and found nothing broken. */
    serviceConfirmedAt: moment,
  }),
  counts: v.object({
    notesReturning: count,
    notesLost: count,
    notesRolledBack: count,
    findingsBroken: count,
    findingsLeftover: count,
    repaired: count,
  }),
  notes: v.string(),
});
export type DrillRecord = v.InferOutput<typeof drillRecordSchema>;
export type Moment = keyof DrillRecord["timeline"];
export type Count = keyof DrillRecord["counts"];
// #endregion record

// #region summary
export type DrillSummary = {
  /** Accident to "the service reads good data again". The recovery time you actually had. */
  rtoSeconds: number | null;
  /** How far back the table went from the accident. Writes in this window are gone unless replayed. */
  rpoSeconds: number | null;
  detectionSeconds: number | null;
  /** RestoreTableToPointInTime, from the request to ACTIVE. */
  tableRestoreSeconds: number | null;
  /** Distance between the two restore points. Not zero means the two stores disagree by design. */
  skewSeconds: number | null;
  missing: Moment[];
};

const seconds = (from: string | null, to: string | null): number | null =>
  from === null || to === null ? null : (new Date(to).getTime() - new Date(from).getTime()) / 1000;

export function summarize(record: DrillRecord): DrillSummary {
  const t = record.timeline;
  const skew = seconds(t.tableRestorePoint, t.objectRestorePoint);
  return {
    rtoSeconds: seconds(t.accidentAt, t.serviceConfirmedAt),
    rpoSeconds: seconds(t.tableRestorePoint, t.accidentAt),
    detectionSeconds: seconds(t.accidentAt, t.detectedAt),
    tableRestoreSeconds: seconds(t.restoreRequestedAt, t.tableActiveAt),
    skewSeconds: skew === null ? null : Math.abs(skew),
    missing: v.keyof(drillRecordSchema.entries.timeline).options.filter((name) => t[name] === null),
  };
}
// #endregion summary

// #region mark
export const isMoment = (record: DrillRecord, name: string): name is Moment =>
  name in record.timeline;
export const isCount = (record: DrillRecord, name: string): name is Count => name in record.counts;

/** A record is evidence: a moment written once is not written over. */
export function mark(record: DrillRecord, name: Moment, at: Date): DrillRecord {
  const existing = record.timeline[name];
  if (existing !== null) {
    throw new Error(
      `${name} is already recorded as ${existing}. Start a new record instead of rewriting this one.`,
    );
  }
  return { ...record, timeline: { ...record.timeline, [name]: at.toISOString() } };
}
// #endregion mark
