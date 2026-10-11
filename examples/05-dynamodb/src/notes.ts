import type { CreateNote, Note, UpdateNote } from "./contract.ts";
import { newNoteId } from "./id.ts";
import type { NoteRepository, Page, UpdateResult } from "./repository.ts";

export type NoteServiceDeps = {
  repository: NoteRepository;
  now: () => Date;
  /** Random lowercase alphanumeric characters that make two IDs created in the same millisecond differ. */
  randomSuffix: () => string;
};

// #region service
// Chapter 06 replaces this constant with the signed-in user. Until then every
// caller reads and writes the same notes.
export const SHARED_OWNER = "anonymous";

/** Every operation names the owner whose notes it touches. Nothing here can reach across owners. */
export function createNoteService(deps: NoteServiceDeps) {
  return {
    list: (owner: string, options: { limit: number; cursor?: string | undefined }): Promise<Page> =>
      deps.repository.list(owner, options),

    get: (owner: string, id: string): Promise<Note | undefined> => deps.repository.get(owner, id),

    async create(owner: string, input: CreateNote): Promise<Note> {
      // An ID collision needs the same millisecond and the same random suffix.
      // If it ever happens the conditional write refuses it, and a fresh ID is tried.
      for (let attempt = 0; attempt < 3; attempt++) {
        const now = deps.now();
        const timestamp = now.toISOString();
        const note: Note = {
          id: newNoteId(now, deps.randomSuffix()),
          title: input.title,
          body: input.body,
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        if ((await deps.repository.create(owner, note)) === "created") {
          return note;
        }
      }
      throw new Error("Could not allocate a note ID after 3 attempts");
    },

    update: (owner: string, id: string, input: UpdateNote): Promise<UpdateResult> =>
      deps.repository.update(owner, id, {
        title: input.title,
        body: input.body,
        expectedVersion: input.expectedVersion,
        updatedAt: deps.now().toISOString(),
      }),

    remove: (owner: string, id: string): Promise<boolean> => deps.repository.delete(owner, id),
  };
}

export type NoteService = ReturnType<typeof createNoteService>;
// #endregion service
