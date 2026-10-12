import type { Snapshot } from "./invariants.ts";

// #region diff
export type NoteRef = { owner: string; noteId: string };

export type TableDiff = {
  /** In the restored table only: deleted after the restore point. This is what the restore is for. */
  returning: NoteRef[];
  /** In the live table only: created after the restore point. Cutting over loses them. */
  lost: NoteRef[];
  /** In both, with a higher version live: updates made after the restore point, which cutting over undoes. */
  rolledBack: (NoteRef & { restoredVersion: number; liveVersion: number })[];
  attachmentsReturning: number;
  attachmentsLost: number;
};

/** What switching from the live table to the restored one gives back, and what it costs. Reads only. */
export function diffTables(
  live: Pick<Snapshot, "notes" | "attachments">,
  restored: Pick<Snapshot, "notes" | "attachments">,
): TableDiff {
  const key = (owner: string, ...rest: string[]): string => [owner, ...rest].join("/");
  const liveNotes = new Map(live.notes.map(({ owner, note }) => [key(owner, note.id), note]));
  const restoredNotes = new Map(
    restored.notes.map(({ owner, note }) => [key(owner, note.id), note]),
  );
  const attachmentKeys = (side: Pick<Snapshot, "attachments">): Set<string> =>
    new Set(
      side.attachments.map(({ owner, attachment }) => key(owner, attachment.noteId, attachment.id)),
    );
  const liveAttachments = attachmentKeys(live);
  const restoredAttachments = attachmentKeys(restored);

  const diff: TableDiff = {
    returning: [],
    lost: [],
    rolledBack: [],
    attachmentsReturning: 0,
    attachmentsLost: 0,
  };
  for (const { owner, note } of restored.notes) {
    const current = liveNotes.get(key(owner, note.id));
    if (current === undefined) {
      diff.returning.push({ owner, noteId: note.id });
    } else if (current.version > note.version) {
      diff.rolledBack.push({
        owner,
        noteId: note.id,
        restoredVersion: note.version,
        liveVersion: current.version,
      });
    }
  }
  for (const { owner, note } of live.notes) {
    if (!restoredNotes.has(key(owner, note.id))) {
      diff.lost.push({ owner, noteId: note.id });
    }
  }
  diff.attachmentsReturning = [...restoredAttachments].filter(
    (id) => !liveAttachments.has(id),
  ).length;
  diff.attachmentsLost = [...liveAttachments].filter((id) => !restoredAttachments.has(id)).length;
  return diff;
}
// #endregion diff

// #region fence
export type NoteVersionStore = {
  /** Sets the version to `to` unless it is already there or beyond. One step in the store. */
  raiseVersion(owner: string, id: string, to: number): Promise<"raised" | "unchanged">;
};

/**
 * A restore brings old version numbers back. Chapter 05's lock compares
 * numbers, so a browser still holding the pre-restore version 5 would pass
 * once the restored note is edited up to 5 again. Raising the restored
 * version past every number the live table handed out closes that.
 */
export async function fenceVersions(
  restored: NoteVersionStore,
  diff: Pick<TableDiff, "rolledBack">,
  options: { dryRun: boolean },
): Promise<(NoteRef & { to: number })[]> {
  const fences = diff.rolledBack.map(({ owner, noteId, liveVersion }) => ({
    owner,
    noteId,
    to: liveVersion + 1,
  }));
  if (!options.dryRun) {
    for (const fence of fences) {
      await restored.raiseVersion(fence.owner, fence.noteId, fence.to);
    }
  }
  return fences;
}
// #endregion fence
