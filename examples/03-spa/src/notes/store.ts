import { z } from "zod";

import { type Note, type NoteDraft, noteDraftSchema, noteSchema } from "./note.ts";

// #region interface
export type NoteStore = {
  list(): Note[];
  get(id: string): Note | undefined;
  save(draft: NoteDraft, id?: string): Note;
  remove(id: string): void;
};
// #endregion interface

/** Narrow enough that a Map-backed fake satisfies it in tests. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export type StoreDeps = {
  storage: KeyValueStorage;
  now: () => Date;
  newId: () => string;
};

const STORAGE_KEY = "aih.notes.v1";

// #region read
// localStorage is outside the type system. Whatever does not match the schema is dropped.
function read(storage: KeyValueStorage): Note[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    return [];
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = z.array(z.unknown()).safeParse(json);
  if (!items.success) {
    return [];
  }
  return items.data.flatMap((item) => {
    const note = noteSchema.safeParse(item);
    return note.success ? [note.data] : [];
  });
}
// #endregion read

export function createLocalNoteStore(deps: StoreDeps): NoteStore {
  const write = (notes: Note[]): void => deps.storage.setItem(STORAGE_KEY, JSON.stringify(notes));

  return {
    list: () => read(deps.storage).toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    get: (id) => read(deps.storage).find((note) => note.id === id),
    save(draft, id) {
      const note: Note = {
        ...noteDraftSchema.parse(draft),
        id: id ?? deps.newId(),
        updatedAt: deps.now().toISOString(),
      };
      write([...read(deps.storage).filter((existing) => existing.id !== note.id), note]);
      return note;
    },
    remove(id) {
      write(read(deps.storage).filter((note) => note.id !== id));
    },
  };
}
