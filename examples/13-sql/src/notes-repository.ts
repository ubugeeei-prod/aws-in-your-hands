import * as v from "valibot";

import { MAX_LISTED_NOTES, type Note, type NoteSummary } from "./contract.ts";
import { type Queryable, rows } from "./db.ts";
import type { TransactionRunner } from "./transaction.ts";

// #region interface
export type CreateResult = "created" | "quota_exceeded";
export type UpdateResult =
  | { status: "updated"; note: Note }
  // `current` is what is stored now.
  | { status: "conflict"; current: Note }
  | { status: "not_found" };

export type NoteRepository = {
  /** Creating the same note (same id) twice leaves one note. */
  create(owner: string, note: Note): Promise<CreateResult>;
  get(owner: string, id: string): Promise<Note | undefined>;
  /** Newest first, at most MAX_LISTED_NOTES, without the bodies. */
  list(owner: string): Promise<NoteSummary[]>;
  /** Moves the version from `expectedVersion` to `expectedVersion + 1`. */
  update(
    owner: string,
    id: string,
    change: { title: string; body: string; expectedVersion: number; updatedAt: string },
  ): Promise<UpdateResult>;
  delete(owner: string, id: string): Promise<boolean>;
};
// #endregion interface

// #region row
// node-postgres and PGlite both hand back timestamptz as a Date and integer as a number.
const noteRowSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.uuid()),
    title: v.string(),
    body: v.string(),
    version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    created_at: v.date(),
    updated_at: v.date(),
  }),
  v.transform((row): Note => ({
    id: row.id,
    title: row.title,
    body: row.body,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  })),
);

const NOTE_COLUMNS = "id, title, body, version, created_at, updated_at";
// #endregion row

// A list row has no `body` column, so a list response cannot carry one.
const summaryRowSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.uuid()),
    title: v.string(),
    version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    created_at: v.date(),
    updated_at: v.date(),
  }),
  v.transform((row): NoteSummary => ({
    id: row.id,
    title: row.title,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  })),
);

const idRowSchema = v.object({ id: v.pipe(v.string(), v.uuid()) });
const countRowSchema = v.object({ note_count: v.pipe(v.number(), v.safeInteger(), v.minValue(0)) });

async function selectNote(tx: Queryable, owner: string, id: string): Promise<Note | undefined> {
  const [note] = await rows(
    tx,
    noteRowSchema,
    `SELECT ${NOTE_COLUMNS} FROM app.notes WHERE owner = $1 AND id = $2`,
    [owner, id],
  );
  return note;
}

export class SqlNoteRepository implements NoteRepository {
  readonly #transaction: TransactionRunner;
  readonly #maxNotesPerOwner: number;

  constructor(transaction: TransactionRunner, maxNotesPerOwner: number) {
    this.#transaction = transaction;
    this.#maxNotesPerOwner = maxNotesPerOwner;
  }

  // #region create
  create(owner: string, note: Note): Promise<CreateResult> {
    // Everything this decides, it decides from rows read inside the
    // transaction. A retry therefore decides again, from the data as it is then.
    return this.#transaction(async (tx) => {
      // An earlier attempt may have committed without the caller hearing of it.
      if ((await selectNote(tx, owner, note.id)) !== undefined) {
        return "created";
      }
      await tx.query(
        "INSERT INTO app.owners (owner, note_count) VALUES ($1, 0) ON CONFLICT (owner) DO NOTHING",
        [owner],
      );
      // Two creates by one owner both write this row, so the database lets only
      // one of them commit. Counting app.notes instead would let both pass.
      const counted = await rows(
        tx,
        countRowSchema,
        "UPDATE app.owners SET note_count = note_count + 1 WHERE owner = $1 AND note_count < $2 RETURNING note_count",
        [owner, this.#maxNotesPerOwner],
      );
      if (counted.length === 0) {
        return "quota_exceeded";
      }
      await tx.query(
        "INSERT INTO app.notes (id, owner, title, body, version, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [note.id, owner, note.title, note.body, note.version, note.createdAt, note.updatedAt],
      );
      return "created";
    });
  }
  // #endregion create

  get(owner: string, id: string): Promise<Note | undefined> {
    return this.#transaction((tx) => selectNote(tx, owner, id));
  }

  // #region list
  list(owner: string): Promise<NoteSummary[]> {
    return this.#transaction((tx) =>
      rows(
        tx,
        summaryRowSchema,
        `SELECT id, title, version, created_at, updated_at FROM app.notes
         WHERE owner = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
        [owner, MAX_LISTED_NOTES],
      ),
    );
  }
  // #endregion list

  // #region update
  update(
    owner: string,
    id: string,
    change: { title: string; body: string; expectedVersion: number; updatedAt: string },
  ): Promise<UpdateResult> {
    return this.#transaction(async (tx): Promise<UpdateResult> => {
      // The version check and the write are one statement, so no other writer fits between them.
      const [note] = await rows(
        tx,
        noteRowSchema,
        `UPDATE app.notes SET title = $3, body = $4, version = version + 1, updated_at = $5
         WHERE owner = $1 AND id = $2 AND version = $6 RETURNING ${NOTE_COLUMNS}`,
        [owner, id, change.title, change.body, change.updatedAt, change.expectedVersion],
      );
      if (note !== undefined) {
        return { status: "updated", note };
      }
      const current = await selectNote(tx, owner, id);
      return current === undefined ? { status: "not_found" } : { status: "conflict", current };
    });
  }
  // #endregion update

  // #region delete
  delete(owner: string, id: string): Promise<boolean> {
    return this.#transaction(async (tx) => {
      const deleted = await rows(
        tx,
        idRowSchema,
        "DELETE FROM app.notes WHERE owner = $1 AND id = $2 RETURNING id",
        [owner, id],
      );
      if (deleted.length === 0) {
        return false;
      }
      await tx.query("UPDATE app.owners SET note_count = note_count - 1 WHERE owner = $1", [owner]);
      return true;
    });
  }
  // #endregion delete
}
