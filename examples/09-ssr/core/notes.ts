import { z } from "zod";

// #region note
export const publicNoteSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  title: z.string().min(1).max(120),
  body: z.string().max(4000),
  updatedAt: z.iso.datetime(),
});
export type PublicNote = z.infer<typeof publicNoteSchema>;

export const noteListSchema = z.object({ notes: z.array(publicNoteSchema) });
export type NoteList = z.infer<typeof noteListSchema>;
// #endregion note

export interface PublicNotes {
  list(): PublicNote[];
  find(id: string): PublicNote | undefined;
}

/** Read-only notes that ship with the code, so every execution environment gives the same answer. */
export function createStaticNotes(seed: unknown): PublicNotes {
  const notes = z.array(publicNoteSchema).parse(seed);
  const byId = new Map(notes.map((note) => [note.id, note]));
  if (byId.size !== notes.length) {
    throw new Error("Seed notes contain a duplicate id");
  }
  return {
    list: () => notes.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    find: (id) => byId.get(id),
  };
}

export const feedLines = (notes: PublicNote[]): string[] =>
  notes.map((note) => `${note.updatedAt.slice(0, 10)} ${note.title}\n`);
