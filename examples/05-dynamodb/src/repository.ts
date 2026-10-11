import type { Note } from "./contract.ts";

// #region interface
export type Page = { notes: Note[]; nextCursor: string | null };

export type CreateResult = "created" | "already_exists";
export type UpdateResult =
  | { status: "updated"; note: Note }
  // The stored version is not the one the caller expected. `current` is what is stored.
  | { status: "conflict"; current: Note }
  | { status: "not_found" };

/**
 * Everything the application asks of its storage. Expected outcomes such as
 * "someone else saved first" are return values, not exceptions: a caller has
 * to handle them, and the type checker makes sure it does.
 */
export interface NoteRepository {
  /** Stores a new note. Never overwrites an existing one. */
  create(owner: string, note: Note): Promise<CreateResult>;
  get(owner: string, id: string): Promise<Note | undefined>;
  /** Newest first. */
  list(owner: string, options: { limit: number; cursor?: string | undefined }): Promise<Page>;
  /** Replaces title and body, and moves the version from `expectedVersion` to `expectedVersion + 1`. */
  update(
    owner: string,
    id: string,
    change: { title: string; body: string; expectedVersion: number; updatedAt: string },
  ): Promise<UpdateResult>;
  delete(owner: string, id: string): Promise<boolean>;
}

export class InvalidCursorError extends Error {
  constructor() {
    super("The cursor is not one this API issued.");
    this.name = "InvalidCursorError";
  }
}
// #endregion interface

// #region cursor
// A cursor travels to the client and back, so on return it is untrusted input
// like any other. It is decoded and checked, never passed through as is.
const CURSOR = /^[0-9a-z]{1,64}$/;

export function encodeCursor(lastNoteId: string): string {
  return Buffer.from(lastNoteId, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!CURSOR.test(id)) {
    throw new InvalidCursorError();
  }
  return id;
}
// #endregion cursor
