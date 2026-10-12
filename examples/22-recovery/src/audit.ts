import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";

import { check, type Report, SEVERITY, takeSnapshot } from "./invariants.ts";
import type { TableReader } from "./items.ts";
import type { VersionedBucket } from "./versioned-bucket.ts";

// #region audit
// Also what the function returns, so the caller checks it like any outside data.
const count = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

// v.record would take an array, and would leave out a key named "constructor" without
// saying so. A count that goes missing is what this report exists to prevent.
const countsByKind = v.custom<Record<string, number>>(
  (input) =>
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Object.values(input).every((value) => Number.isSafeInteger(value) && value >= 1),
  "expected an object of positive counts",
);

export const auditSchema = v.object({
  tableName: v.string(),
  checkedAt: utcTimestamp,
  notes: count,
  attachments: count,
  inspections: count,
  objects: count,
  tooYoung: count,
  broken: count,
  leftover: count,
  byKind: countsByKind,
});
export type Audit = v.InferOutput<typeof auditSchema>;

export type AuditDeps = {
  tableName: string;
  table: TableReader;
  bucket: Pick<VersionedBucket, "listCurrent">;
  now: () => Date;
};

/** Reads both stores and counts what does not line up. Changes nothing. */
export async function audit(
  deps: AuditDeps,
  options: { graceMs?: number } = {},
): Promise<Audit & { report: Report }> {
  const snapshot = await takeSnapshot(deps.table, deps.bucket);
  const report = check(snapshot, { now: deps.now(), ...options });
  const byKind: Record<string, number> = {};
  for (const finding of report.findings) {
    byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
  }
  const count = (severity: "broken" | "leftover"): number =>
    report.findings.filter((finding) => SEVERITY[finding.kind] === severity).length;
  return {
    tableName: deps.tableName,
    checkedAt: deps.now().toISOString(),
    notes: snapshot.notes.length,
    attachments: snapshot.attachments.length,
    inspections: snapshot.inspections.length,
    objects: snapshot.objects.length,
    tooYoung: report.tooYoung,
    broken: count("broken"),
    leftover: count("leftover"),
    byKind,
    report,
  };
}
// #endregion audit
