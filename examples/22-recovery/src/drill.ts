import { z } from "zod";

// #region record
const moment = z.iso.datetime().nullable();
const count = z.number().int().nonnegative().nullable();

// Every field starts as null and is filled in during the drill. A field that
// stays null is a step that did not happen, and the summary says so.
export const drillRecordSchema = z.object({
  name: z.string().min(1),
  region: z.string().min(1),
  tableName: z.string().nullable(),
  restoredTableName: z.string().nullable(),
  bucketName: z.string().nullable(),
  timeline: z.object({
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
  counts: z.object({
    notesReturning: count,
    notesLost: count,
    notesRolledBack: count,
    findingsBroken: count,
    findingsLeftover: count,
    repaired: count,
  }),
  notes: z.string(),
});
export type DrillRecord = z.infer<typeof drillRecordSchema>;
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
    missing: drillRecordSchema.shape.timeline.keyof().options.filter((name) => t[name] === null),
  };
}
// #endregion summary

// #region mark
export const isMoment = (record: DrillRecord, name: string): name is Moment => name in record.timeline;
export const isCount = (record: DrillRecord, name: string): name is Count => name in record.counts;

/** A record is evidence: a moment written once is not written over. */
export function mark(record: DrillRecord, name: Moment, at: Date): DrillRecord {
  const existing = record.timeline[name];
  if (existing !== null) {
    throw new Error(`${name} is already recorded as ${existing}. Start a new record instead of rewriting this one.`);
  }
  return { ...record, timeline: { ...record.timeline, [name]: at.toISOString() } };
}
// #endregion mark
