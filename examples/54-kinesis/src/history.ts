import type { Revision } from "./revision.ts";

// #region history
/** What the consumer derives for one note: where it is, and from how many revisions. */
export type NoteHistory = {
  noteId: string;
  owner: string;
  /** The highest version applied. Never goes down. */
  version: number;
  /** How many revisions were applied. Equal to `version` when none was missed. */
  revisions: number;
  deleted: boolean;
  updatedAt: string;
};

/** Revisions that never arrived, or arrived after a later one and were set aside. */
export const missingOf = (history: NoteHistory): number => history.version - history.revisions;

export type HistoryStore = {
  /**
   * Applies the revision only if it is newer than what is stored. Comparing
   * and writing are one step: two deliveries of one revision cannot both pass.
   */
  apply(revision: Revision): Promise<"applied" | "stale">;
  /** Applies whatever arrives. Correct only if each revision arrives once, in order. */
  applyBlindly(revision: Revision): Promise<void>;
  get(noteId: string): Promise<NoteHistory | undefined>;
};
// #endregion history

export class InMemoryHistoryStore implements HistoryStore {
  readonly #notes = new Map<string, NoteHistory>();

  async apply(revision: Revision) {
    // No `await` between the comparison and the write: one step, as the condition is in DynamoDB.
    const stored = this.#notes.get(revision.noteId);
    if (stored !== undefined && stored.version >= revision.version) {
      return "stale" as const;
    }
    this.#write(revision, stored);
    return "applied" as const;
  }

  async applyBlindly(revision: Revision) {
    this.#write(revision, this.#notes.get(revision.noteId));
  }

  async get(noteId: string) {
    const stored = this.#notes.get(noteId);
    return stored === undefined ? undefined : { ...stored };
  }

  all(): NoteHistory[] {
    return [...this.#notes.values()].map((history) => ({ ...history }));
  }

  #write(revision: Revision, stored: NoteHistory | undefined): void {
    this.#notes.set(revision.noteId, {
      noteId: revision.noteId,
      owner: revision.owner,
      version: revision.version,
      revisions: (stored?.revisions ?? 0) + 1,
      deleted: revision.kind === "deleted",
      updatedAt: revision.at,
    });
  }
}
