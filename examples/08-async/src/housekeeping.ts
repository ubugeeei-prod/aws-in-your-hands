import type { AttachmentRepository } from "@aih/example-07-uploads/api/src/attachment-repository.ts";
import { KEY_PREFIX, parseObjectKey } from "@aih/example-07-uploads/api/src/keys.ts";
import type { ObjectStore } from "@aih/example-07-uploads/api/src/object-store.ts";
import { SWEEP_GRACE_MS, type SweepReport, sweep } from "@aih/example-07-uploads/api/src/sweep.ts";

import type { InspectionRepository } from "./inspection.ts";

// #region housekeeping
// The lifecycle rule deletes a pending object one day after it was created,
// at the earliest. An object older than this window that still exists was
// either never pending again or is beyond saving.
export const UNTAG_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export type HousekeepingDeps = {
  objects: Pick<ObjectStore, "list" | "delete" | "markAttached">;
  attachments: Pick<AttachmentRepository, "get" | "delete">;
  notes: { get(owner: string, id: string): Promise<unknown> };
  inspections: Pick<InspectionRepository, "get">;
  now: () => Date;
};

export type HousekeepingReport = {
  /** Chapter 07's sweep: objects that no record, or no note, points at. */
  orphans: SweepReport;
  /** Attached images whose bytes failed the inspection. */
  rejected: { key: string; reason: string }[];
  /** Attached images whose pending tag was taken off again, whether or not it was on. */
  untagged: number;
};

/**
 * Everything here acts only on objects older than chapter 07's grace period,
 * so it never meets a request that is still finishing an upload. Running it
 * twice, or twice at once, ends in the same state as running it once.
 */
export async function housekeep(
  deps: HousekeepingDeps,
  options: { dryRun: boolean },
): Promise<HousekeepingReport> {
  const orphans = await sweep(deps, options);
  const report: HousekeepingReport = { orphans, rejected: [], untagged: 0 };

  for await (const object of deps.objects.list(KEY_PREFIX)) {
    const age = deps.now().getTime() - object.lastModified.getTime();
    const parts = parseObjectKey(object.key);
    if (age < SWEEP_GRACE_MS || parts === undefined) {
      continue;
    }
    if ((await deps.attachments.get(parts.owner, parts.noteId, parts.attachmentId)) === undefined) {
      continue;
    }

    const inspection = await deps.inspections.get(parts.owner, parts.noteId, parts.attachmentId);
    // A verdict counts only if it was reached after these bytes arrived. An
    // older one is about an object that has since been replaced.
    const current =
      inspection !== undefined && new Date(inspection.inspectedAt) >= object.lastModified;
    if (current && inspection.verdict === "rejected") {
      if (!options.dryRun) {
        // Chapter 07's order for a delete: the record first, then the object.
        await deps.attachments.delete(parts.owner, parts.noteId, parts.attachmentId);
        await deps.objects.delete(object.key);
      }
      report.rejected.push({ key: object.key, reason: inspection.reason ?? "rejected" });
      continue;
    }

    // The backstop for the worker's step 4. An event can be late, or sit in
    // the dead-letter queue; this does not depend on any event arriving.
    if (age < UNTAG_WINDOW_MS) {
      if (!options.dryRun) {
        await deps.objects.markAttached(object.key);
      }
      report.untagged++;
    }
  }
  return report;
}
// #endregion housekeeping
