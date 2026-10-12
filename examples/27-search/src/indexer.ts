import { MAX_PASSAGES_PER_NOTE, passagesOf, vectorKey, vectorKeys } from "./chunk.ts";
import type { Embedder } from "./embedder.ts";
import type { VectorIndex } from "./vector-index.ts";

// #region change
export type NoteImage = { title: string; body: string; version: number };

/** One change to one note, as a stream record tells it. `after` is absent for a delete. */
export type NoteChange = {
  owner: string;
  noteId: string;
  /** "none": the note is new. "unknown": it may have been indexed, and nobody knows how long it was. */
  before: NoteImage | "none" | "unknown";
  after: NoteImage | undefined;
};
// #endregion change

// #region plan
export type IndexPlan = {
  embed: { key: string; passage: number; text: string }[];
  /** Passages the note had before and no longer has. */
  remove: string[];
  version: number | undefined;
};

/** What the index must hold after this change. Deciding it needs no network, so it is tested alone. */
export function planChange(change: NoteChange): IndexPlan {
  const passages = change.after === undefined ? [] : passagesOf(change.after);
  const before =
    change.before === "none"
      ? 0
      : change.before === "unknown"
        ? // No telling how long the note was: clear every key it could have had.
          MAX_PASSAGES_PER_NOTE
        : passagesOf(change.before).length;
  return {
    embed: passages.map((passage) => ({
      key: vectorKey(change.owner, change.noteId, passage.index),
      passage: passage.index,
      text: passage.text,
    })),
    remove: vectorKeys(change.owner, change.noteId, passages.length, before),
    version: change.after?.version,
  };
}
// #endregion plan

export type Indexer = (change: NoteChange) => Promise<void>;

// #region apply
/**
 * Applying the same change twice leaves the index as applying it once does: every
 * write replaces by key, every delete names its keys.
 */
export function createIndexer(deps: { embedder: Embedder; index: VectorIndex }): Indexer {
  return async (change) => {
    const plan = planChange(change);
    if (plan.version !== undefined && plan.embed.length > 0) {
      const version = plan.version;
      const entries = [];
      for (const passage of plan.embed) {
        entries.push({
          key: passage.key,
          vector: await deps.embedder.embed(passage.text),
          owner: change.owner,
          noteId: change.noteId,
          version,
          passage: passage.passage,
        });
      }
      // New passages first. If this stops before the delete, a leftover passage of the old
      // version stays, and the search ignores it because its version is no longer current.
      await deps.index.put(entries);
    }
    if (plan.remove.length > 0) {
      await deps.index.delete(plan.remove);
    }
  };
}
// #endregion apply
