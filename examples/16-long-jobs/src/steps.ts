import { z } from "zod";
import type { ExportStore } from "./export-store.ts";
import {
  ExportCorruptError,
  exportPrefix,
  type Manifest,
  manifestKey,
  partKey,
  partsPrefix,
  type Progress,
} from "./job.ts";
import type { NoteSource } from "./note-source.ts";

export type Deps = { source: NoteSource; store: ExportStore };

// #region budget
export type Budget = {
  /** Notes per part file. */
  pageSize: number;
  /** Asked after every page: is there room for one more before this call must return? */
  mayContinue: () => boolean;
};

/** For callers without a clock to watch: stop after this many pages. */
export function atMostPages(pages: number): () => boolean {
  let left = pages;
  return () => --left > 0;
}
// #endregion budget

// What a part says about itself. Stored as S3 metadata, read back when the part was already there.
const partMetadataSchema = z.object({
  count: z.coerce.number().int().positive(),
  next: z.string().min(1).optional(),
});

// #region export-pages
/**
 * Writes part files from `progress` onwards until the notes run out or the
 * budget does. Safe to run twice from the same `progress`, and safe to run
 * while another copy is running.
 */
export async function exportPages(deps: Deps, progress: Progress, budget: Budget): Promise<Progress> {
  let { cursor, nextPart, notes, done } = progress;
  while (!done) {
    const page = await deps.source.page(cursor, budget.pageSize);
    if (page.notes.length === 0) {
      // A filtered scan can return an empty page that is not the last one.
      cursor = page.nextCursor;
    } else {
      const key = partKey(progress.exportId, nextPart);
      const body = `${page.notes.map((note) => JSON.stringify(note)).join("\n")}\n`;
      const mine = { count: String(page.notes.length), ...(page.nextCursor === null ? {} : { next: page.nextCursor }) };
      const result = await deps.store.putIfAbsent(key, body, mine);
      // If the part was already there, an earlier attempt wrote it, and what it
      // wrote is what counts: where it stopped is where the next part starts.
      const kept = partMetadataSchema.parse(result === "written" ? mine : await deps.store.head(key));
      cursor = kept.next ?? null;
      notes += kept.count;
      nextPart += 1;
    }
    done = cursor === null;
    if (!budget.mayContinue()) {
      break;
    }
  }
  return { exportId: progress.exportId, cursor, nextPart, notes, done };
}
// #endregion export-pages

// #region finish
export type Finished = { exportId: string; manifestKey: string; parts: number; notes: number };

/** Checks that every part is there, then writes the manifest that makes the export visible. */
export async function finishExport(deps: Pick<Deps, "store">, progress: Progress): Promise<Finished> {
  if (!progress.done) {
    throw new Error(`export ${progress.exportId} still has pages to write`);
  }
  const parts = Array.from({ length: progress.nextPart - 1 }, (_, index) => partKey(progress.exportId, index + 1));
  const present = new Set(await deps.store.list(partsPrefix(progress.exportId)));
  const missing = parts.filter((key) => !present.has(key));
  if (missing.length > 0) {
    // Retrying cannot bring a part back. The workflow catches this name and discards the export.
    throw new ExportCorruptError(`${missing.length} of ${parts.length} parts are missing, first ${missing[0]}`);
  }
  const manifest: Manifest = { exportId: progress.exportId, notes: progress.notes, parts };
  // No timestamp inside: two runs of the same export write byte-identical manifests.
  await deps.store.putIfAbsent(manifestKey(progress.exportId), `${JSON.stringify(manifest, null, 2)}\n`, {});
  return {
    exportId: progress.exportId,
    manifestKey: manifestKey(progress.exportId),
    parts: parts.length,
    notes: progress.notes,
  };
}
// #endregion finish

// #region discard
export type Discarded = { exportId: string; removed: number; kept: boolean };

/** The compensation: takes back what the earlier steps wrote. Never touches a finished export. */
export async function discardExport(
  deps: Pick<Deps, "store">,
  progress: Pick<Progress, "exportId">,
): Promise<Discarded> {
  const keys = await deps.store.list(exportPrefix(progress.exportId));
  if (keys.includes(manifestKey(progress.exportId))) {
    return { exportId: progress.exportId, removed: 0, kept: true };
  }
  for (const key of keys) {
    await deps.store.delete(key);
  }
  return { exportId: progress.exportId, removed: keys.length, kept: false };
}
// #endregion discard
