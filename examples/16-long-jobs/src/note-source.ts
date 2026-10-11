import { noteSchema } from "@aih/example-05-dynamodb/src/contract.ts";
import { z } from "zod";

// #region port
export const exportedNoteSchema = noteSchema.extend({ owner: z.string().min(1) });
export type ExportedNote = z.infer<typeof exportedNoteSchema>;

export type NotePage = { notes: ExportedNote[]; nextCursor: string | null };

/** Every owner's notes, a page at a time, in an order that does not change between calls. */
export interface NoteSource {
  page(cursor: string | null, limit: number): Promise<NotePage>;
}
// #endregion port

const encode = (key: string): string => Buffer.from(key, "utf8").toString("base64url");
const decode = (cursor: string): string => Buffer.from(cursor, "base64url").toString("utf8");

/** For the local run and the tests. Notes can come and go between pages, as they do in a real table. */
export class MemoryNoteSource implements NoteSource {
  readonly #notes = new Map<string, ExportedNote>();

  put(note: ExportedNote): void {
    this.#notes.set(`${note.owner}/${note.id}`, note);
  }

  remove(owner: string, id: string): void {
    this.#notes.delete(`${owner}/${id}`);
  }

  async page(cursor: string | null, limit: number): Promise<NotePage> {
    const after = cursor === null ? "" : decode(cursor);
    const keys = [...this.#notes.keys()].filter((key) => key > after).toSorted();
    const taken = keys.slice(0, limit);
    const last = taken.at(-1);
    return {
      notes: taken.flatMap((key) => this.#notes.get(key) ?? []),
      nextCursor: keys.length > limit && last !== undefined ? encode(last) : null,
    };
  }
}
