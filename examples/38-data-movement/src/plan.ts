// What one task execution would do, from a listing of each side. A model of the
// behaviour DataSync documents for TransferMode, OverwriteMode,
// PreserveDeletedFiles and filters. It does not call DataSync and is not DataSync.

import * as v from "valibot";

import { filterMatches } from "./filters.ts";
import type { ArchiveTask } from "./task.ts";

// #region listing
export const objectEntrySchema = v.object({
  key: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
  size: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  /** A hash of the bytes. An S3 ETag is one only for objects that were not uploaded in parts. */
  checksum: v.pipe(v.string(), v.minLength(1)),
  lastModified: v.pipe(v.string(), v.isoTimestamp()),
});
export type ObjectEntry = v.InferOutput<typeof objectEntrySchema>;

export const listingSchema = v.array(objectEntrySchema);
// #endregion listing

export type Transfer = {
  key: string;
  size: number;
  reason: "new" | "changed" | "all";
  /** The copy in the destination was written after the source's. Overwriting loses that write. */
  destinationNewer: boolean;
};
export type Skip = {
  key: string;
  reason: "same" | "not_included" | "excluded" | "overwrite_never";
};
export type Plan = {
  transfer: Transfer[];
  skip: Skip[];
  delete: string[];
  bytes: number;
};

const inKeyOrder = (entries: readonly ObjectEntry[]): ObjectEntry[] =>
  entries.toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

const byKey = (entries: readonly ObjectEntry[]): Map<string, ObjectEntry> =>
  new Map(entries.map((entry) => [entry.key, entry]));

// #region selected
/** Inside the task's scope: named by the include filter if there is one, and not excluded. */
export function scopeOf(task: ArchiveTask, key: string): "in" | "not_included" | "excluded" {
  if (task.includes !== undefined && !filterMatches(task.includes, key)) {
    return "not_included";
  }
  return filterMatches(task.excludes, key) ? "excluded" : "in";
}
// #endregion selected

// #region plan
export function planExecution(
  source: readonly ObjectEntry[],
  destination: readonly ObjectEntry[],
  task: ArchiveTask,
): Plan {
  const { options } = task;
  const existing = byKey(destination);
  const plan: Plan = { transfer: [], skip: [], delete: [], bytes: 0 };

  for (const entry of inKeyOrder(source)) {
    const scope = scopeOf(task, entry.key);
    if (scope !== "in") {
      plan.skip.push({ key: entry.key, reason: scope });
      continue;
    }
    const copy = existing.get(entry.key);
    if (copy === undefined) {
      plan.transfer.push({
        key: entry.key,
        size: entry.size,
        reason: "new",
        destinationNewer: false,
      });
      continue;
    }
    const same = copy.size === entry.size && copy.checksum === entry.checksum;
    if (options.transferMode === "CHANGED" && same) {
      plan.skip.push({ key: entry.key, reason: "same" });
      continue;
    }
    if (options.overwriteMode === "NEVER") {
      // Protects a write made in the destination, and for the same reason
      // never delivers a later change from the source.
      plan.skip.push({ key: entry.key, reason: "overwrite_never" });
      continue;
    }
    plan.transfer.push({
      key: entry.key,
      size: entry.size,
      reason: options.transferMode === "ALL" ? "all" : "changed",
      destinationNewer: !same && Date.parse(copy.lastModified) > Date.parse(entry.lastModified),
    });
  }

  if (options.preserveDeletedFiles === "REMOVE") {
    const present = byKey(source);
    for (const copy of inKeyOrder(destination)) {
      // What the filters keep out of the copy is also kept out of the cleanup.
      if (!present.has(copy.key) && scopeOf(task, copy.key) === "in") {
        plan.delete.push(copy.key);
      }
    }
  }

  plan.bytes = plan.transfer.reduce((sum, transfer) => sum + transfer.size, 0);
  return plan;
}
// #endregion plan
