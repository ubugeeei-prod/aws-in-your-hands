import { z } from "zod";
import { check, type Report, SEVERITY, takeSnapshot } from "./invariants.ts";
import type { TableReader } from "./items.ts";
import type { VersionedBucket } from "./versioned-bucket.ts";

// #region audit
// Also what the function returns, so the caller checks it like any outside data.
export const auditSchema = z.object({
  tableName: z.string(),
  checkedAt: z.iso.datetime(),
  notes: z.number().int().nonnegative(),
  attachments: z.number().int().nonnegative(),
  inspections: z.number().int().nonnegative(),
  objects: z.number().int().nonnegative(),
  tooYoung: z.number().int().nonnegative(),
  broken: z.number().int().nonnegative(),
  leftover: z.number().int().nonnegative(),
  byKind: z.record(z.string(), z.number().int().positive()),
});
export type Audit = z.infer<typeof auditSchema>;

export type AuditDeps = {
  tableName: string;
  table: TableReader;
  bucket: Pick<VersionedBucket, "listCurrent">;
  now: () => Date;
};

/** Reads both stores and counts what does not line up. Changes nothing. */
export async function audit(deps: AuditDeps, options: { graceMs?: number } = {}): Promise<Audit & { report: Report }> {
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
