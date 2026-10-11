import type { Note } from "./contract.ts";

// #region interface
export type Page = { notes: Note[]; nextCursor: string | null };

export type CreateResult = "created" | "already_exists";
export type UpdateResult =
  | { status: "updated"; note: Note }
  // `current` is what is stored now.
  | { status: "conflict"; current: Note }
  | { status: "not_found" };

// "Someone else saved first" is a return value, not an exception, so the
// type checker makes every caller handle it.
export interface NoteRepository {
  /** Never overwrites an existing note. */
  create(owner: string, note: Note): Promise<CreateResult>;
  get(owner: string, id: string): Promise<Note | undefined>;
  /** Newest first. */
  list(owner: string, options: { limit: number; cursor?: string | undefined }): Promise<Page>;
  /** Moves the version from `expectedVersion` to `expectedVersion + 1`. */
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
// A cursor comes back from the client, so it is untrusted input: decoded and
// checked, never passed through as is.
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
