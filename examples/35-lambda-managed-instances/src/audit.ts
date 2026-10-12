import type { Logger } from "@aih/example-04-http-api/src/log.ts";
import type { NoteRepository } from "@aih/example-04-http-api/src/notes.ts";

import type { RequestScope } from "./scope.ts";

// #region audit
/** Writes one log line per change, tagged with the request that asked for it. */
export function audited(
  repository: NoteRepository,
  scope: RequestScope,
  log: Logger,
): NoteRepository {
  const record = (message: string, noteId: string): void =>
    log({ level: "info", message, noteId, requestId: scope.current()?.requestId });
  return {
    list: () => repository.list(),
    get: (id) => repository.get(id),
    async put(note) {
      await repository.put(note);
      // After an await. Another request may have started in this process by now.
      record("note stored", note.id);
    },
    async delete(id) {
      const deleted = await repository.delete(id);
      if (deleted) {
        record("note deleted", id);
      }
      return deleted;
    },
  };
}
// #endregion audit
