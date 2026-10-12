import * as v from "valibot";

// #region note
export const publicNoteSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,40}$/)),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  body: v.pipe(v.string(), v.maxLength(4000)),
  updatedAt: v.pipe(v.string(), v.isoTimestamp()),
});
export type PublicNote = v.InferOutput<typeof publicNoteSchema>;

export const noteListSchema = v.object({ notes: v.array(publicNoteSchema) });
export type NoteList = v.InferOutput<typeof noteListSchema>;
// #endregion note

export type PublicNotes = {
  list(): PublicNote[];
  find(id: string): PublicNote | undefined;
};

/** Read-only notes that ship with the code, so every execution environment gives the same answer. */
export function createStaticNotes(seed: unknown): PublicNotes {
  const notes = v.parse(v.array(publicNoteSchema), seed);
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
