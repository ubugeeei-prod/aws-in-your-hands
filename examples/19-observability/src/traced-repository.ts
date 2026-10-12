import type { NoteRepository } from "@aih/example-05-dynamodb/src/repository.ts";

import { withSpan } from "./telemetry.ts";

// #region repository
// One span per call to the table. The attributes say which operation ran and
// how it ended; the owner, the note and its text stay out of the trace.
export function traceRepository(inner: NoteRepository): NoteRepository {
  const traced = <T>(
    operation: string,
    run: () => Promise<T>,
    outcome: (result: T) => string,
  ): Promise<T> =>
    withSpan(
      `notes.${operation}`,
      { attributes: { "app.repository.operation": operation } },
      async (span) => {
        const result = await run();
        span.setAttribute("app.repository.outcome", outcome(result));
        return result;
      },
    );

  return {
    create: (owner, note) =>
      traced(
        "create",
        () => inner.create(owner, note),
        (result) => result,
      ),
    get: (owner, id) =>
      traced(
        "get",
        () => inner.get(owner, id),
        (note) => (note === undefined ? "not_found" : "found"),
      ),
    list: (owner, options) =>
      traced(
        "list",
        () => inner.list(owner, options),
        (page) => (page.nextCursor === null ? "last_page" : "more"),
      ),
    update: (owner, id, change) =>
      traced(
        "update",
        () => inner.update(owner, id, change),
        (result) => result.status,
      ),
    delete: (owner, id) =>
      traced(
        "delete",
        () => inner.delete(owner, id),
        (deleted) => (deleted ? "deleted" : "not_found"),
      ),
  };
}
// #endregion repository
