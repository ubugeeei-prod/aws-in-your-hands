import type { CreateNote, Note, NoteSummary, UpdateNote } from "./contract.ts";
import type { NoteRepository, UpdateResult } from "./notes-repository.ts";

export type NoteServiceDeps = {
  repository: NoteRepository;
  now: () => Date;
  newId: () => string;
};

// Chapter 06 replaces this with the signed-in user.
export const SHARED_OWNER = "anonymous";

// #region service
export function createNoteService(deps: NoteServiceDeps) {
  return {
    list: (owner: string): Promise<NoteSummary[]> => deps.repository.list(owner),

    get: (owner: string, id: string): Promise<Note | undefined> => deps.repository.get(owner, id),

    async create(owner: string, input: CreateNote): Promise<Note | "quota_exceeded"> {
      // The id and the time are fixed here, outside the transaction. However
      // many times the repository retries, it writes this one note.
      const timestamp = deps.now().toISOString();
      const note: Note = {
        id: deps.newId(),
        title: input.title,
        body: input.body,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      return (await deps.repository.create(owner, note)) === "created" ? note : "quota_exceeded";
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
