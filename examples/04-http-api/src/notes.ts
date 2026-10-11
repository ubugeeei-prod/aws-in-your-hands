import type { CreateNote, Note } from "./contract.ts";

// #region repository
export interface NoteRepository {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | undefined>;
  put(note: Note): Promise<void>;
  delete(id: string): Promise<boolean>;
}

/** Notes in a Map. On Lambda that means one Map per execution environment. */
export class InMemoryNoteRepository implements NoteRepository {
  readonly #notes = new Map<string, Note>();

  async list(): Promise<Note[]> {
    return [...this.#notes.values()].toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<Note | undefined> {
    return this.#notes.get(id);
  }

  async put(note: Note): Promise<void> {
    this.#notes.set(note.id, note);
  }

  async delete(id: string): Promise<boolean> {
    return this.#notes.delete(id);
  }
}
// #endregion repository

// #region service
export type NoteServiceDeps = {
  repository: NoteRepository;
  now: () => Date;
  newId: () => string;
};

export function createNoteService(deps: NoteServiceDeps) {
  return {
    list: () => deps.repository.list(),
    get: (id: string) => deps.repository.get(id),
    async create(input: CreateNote): Promise<Note> {
      const note: Note = { id: deps.newId(), ...input, createdAt: deps.now().toISOString() };
      await deps.repository.put(note);
      return note;
    },
    remove: (id: string) => deps.repository.delete(id),
  };
}

export type NoteService = ReturnType<typeof createNoteService>;
// #endregion service
