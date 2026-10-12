import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import type { LogEntry } from "@aih/example-04-http-api/src/log.ts";
import { InMemoryNoteRepository, type NoteRepository } from "@aih/example-04-http-api/src/notes.ts";

import { createManagedApp } from "../src/app.ts";
import type { RequestScope } from "../src/scope.ts";

export type Harness = {
  app: Fetch;
  lines: LogEntry[];
  /** Resolves when the first write has started and is waiting. */
  writing: Promise<void>;
  /** Lets the waiting write finish. */
  release: () => void;
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * The app with request IDs handed out in order, and a store whose first write
 * waits until the test says so: the place where a real store waits for the network.
 */
export function harness(scope: RequestScope, requestIds: string[]): Harness {
  const lines: LogEntry[] = [];
  const started = deferred();
  const gate = deferred();
  const inner = new InMemoryNoteRepository();
  let first = true;
  const repository: NoteRepository = {
    list: () => inner.list(),
    get: (id) => inner.get(id),
    delete: (id) => inner.delete(id),
    async put(note) {
      if (first) {
        first = false;
        started.resolve();
        await gate.promise;
      }
      await inner.put(note);
    },
  };
  const ids = [...requestIds];
  let notes = 0;
  const app = createManagedApp({
    env: { ALLOWED_ORIGIN: "http://localhost:5173", LOG_LEVEL: "info", STAGE: "test" },
    scope,
    log: (entry) => lines.push(entry),
    repository,
    newRequestId: () => ids.shift() ?? "req-unexpected",
    newId: () => `note-${++notes}`,
    now: () => new Date("2026-10-13T00:00:00.000Z"),
  });
  return { app, lines, writing: started.promise, release: gate.resolve };
}

export const createNote = (title: string): RequestInit => ({
  method: "POST",
  body: JSON.stringify({ title, body: "" }),
});

export const storedBy = (lines: LogEntry[], noteId: string): unknown =>
  lines.find((line) => line.message === "note stored" && line["noteId"] === noteId)?.["requestId"];
