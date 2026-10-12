import type { Note } from "@aih/example-05-dynamodb/src/contract.ts";

import { passagesOf, vectorKey } from "./chunk.ts";
import type { Indexer } from "./indexer.ts";
import type { VectorEntry } from "./vector-index.ts";

// #region plan
export type OwnedNote = { owner: string; note: Note };

export type ReconcilePlan = {
  /** Notes with a passage missing from the index, or indexed at another version. */
  reindex: { owner: string; noteId: string }[];
  /** Vectors for which the table has no passage: deleted notes, old versions, unreadable entries. */
  remove: string[];
};

/** Compares the whole table with the whole index. The table wins every disagreement. */
export function planReconcile(
  notes: OwnedNote[],
  entries: Omit<VectorEntry, "vector">[],
): ReconcilePlan {
  const expected = new Map<string, number>();
  for (const { owner, note } of notes) {
    for (const passage of passagesOf(note)) {
      expected.set(vectorKey(owner, note.id, passage.index), note.version);
    }
  }
  const current = new Set<string>();
  const remove: string[] = [];
  for (const entry of entries) {
    if (expected.get(entry.key) === entry.version) {
      current.add(entry.key);
    } else if (!expected.has(entry.key)) {
      remove.push(entry.key);
    }
    // Present at another version: the reindex below replaces it under the same key.
  }
  const reindex = notes
    .filter(({ owner, note }) =>
      passagesOf(note).some((passage) => !current.has(vectorKey(owner, note.id, passage.index))),
    )
    .map(({ owner, note }) => ({ owner, noteId: note.id }));
  return { reindex, remove };
}
// #endregion plan

// #region reindex
/**
 * Indexes one note from the table, then reads it again. The stream may have indexed a
 * newer version in between, and this write would have put the older one back on top.
 * Repeats until what was read after the write is what was written.
 */
export async function reindexNote(
  deps: { get: (owner: string, id: string) => Promise<Note | undefined>; indexer: Indexer },
  owner: string,
  noteId: string,
  maxRounds = 5,
): Promise<"indexed" | "gone" | "still_changing"> {
  let written: Note | undefined;
  for (let round = 0; round < maxRounds; round += 1) {
    const note = await deps.get(owner, noteId);
    if (written !== undefined && note?.version === written.version) {
      return "indexed";
    }
    if (note === undefined) {
      // Deleted meanwhile. The stream removes its vectors, and so does this.
      await deps.indexer({ owner, noteId, before: written ?? "unknown", after: undefined });
      return "gone";
    }
    await deps.indexer({ owner, noteId, before: written ?? "unknown", after: note });
    written = note;
  }
  return "still_changing";
}
// #endregion reindex
