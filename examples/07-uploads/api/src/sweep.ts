import type { AttachmentRepository } from "./attachment-repository.ts";
import { FINISH_WITHIN_MS } from "./attachments.ts";
import { KEY_PREFIX, parseObjectKey } from "./keys.ts";
import type { ObjectStore } from "./object-store.ts";

// #region sweep
// Four times the finishing window. An object this old can no longer be in the
// middle of being attached, even if the clocks involved disagree by a lot.
export const SWEEP_GRACE_MS = 4 * FINISH_WITHIN_MS;

export type SweepDeps = {
  objects: Pick<ObjectStore, "list" | "delete">;
  attachments: Pick<AttachmentRepository, "get" | "delete">;
  notes: { get(owner: string, id: string): Promise<unknown> };
  now: () => Date;
};

export type SweepReport = {
  kept: number;
  tooYoung: number;
  /** Keys this app did not write. Reported, never deleted. */
  unknown: string[];
  removed: { key: string; reason: "no_record" | "no_note" }[];
};

/** Compares the bucket with the table and removes what nothing points at. */
export async function sweep(deps: SweepDeps, options: { dryRun: boolean; graceMs?: number }): Promise<SweepReport> {
  const graceMs = options.graceMs ?? SWEEP_GRACE_MS;
  const report: SweepReport = { kept: 0, tooYoung: 0, unknown: [], removed: [] };

  for await (const object of deps.objects.list(KEY_PREFIX)) {
    if (deps.now().getTime() - object.lastModified.getTime() < graceMs) {
      report.tooYoung++;
      continue;
    }
    const parts = parseObjectKey(object.key);
    if (parts === undefined) {
      report.unknown.push(object.key);
      continue;
    }
    const record = await deps.attachments.get(parts.owner, parts.noteId, parts.attachmentId);
    const note = await deps.notes.get(parts.owner, parts.noteId);
    if (record !== undefined && note !== undefined) {
      report.kept++;
      continue;
    }
    if (!options.dryRun) {
      // Same order as a user's delete: the record must never outlive its object.
      if (record !== undefined) {
        await deps.attachments.delete(parts.owner, parts.noteId, parts.attachmentId);
      }
      await deps.objects.delete(object.key);
    }
    report.removed.push({ key: object.key, reason: note === undefined ? "no_note" : "no_record" });
  }
  return report;
}
// #endregion sweep
