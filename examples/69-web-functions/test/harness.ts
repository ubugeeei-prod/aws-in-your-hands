import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import type { LogEntry } from "@aih/example-04-http-api/src/log.ts";
import { InMemoryNoteRepository, type NoteRepository } from "@aih/example-04-http-api/src/notes.ts";
import type { RequestScope } from "@aih/example-35-lambda-managed-instances/src/scope.ts";

import { createWebApp, REQUEST_ID_HEADER } from "../src/app.ts";

export type Harness = {
  app: Fetch;
  lines: LogEntry[];
  /** Resolves when the first write has started and is waiting. */
  writing: Promise<void>;
  /** Lets the waiting write finish. */
  release: () => void;
};

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * The app with a store whose first write waits until the test says so:
 * the place where a real store waits for the network, and another request gets its turn.
 */
export function harness(scope: RequestScope): Harness {
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
  let notes = 0;
  let generated = 0;
  const app = createWebApp({
    env: { ALLOWED_ORIGIN: "http://localhost:5173", LOG_LEVEL: "info", STAGE: "test" },
    release: "test-release",
    scope,
    log: (entry) => lines.push(entry),
    repository,
    newRequestId: () => `generated-${++generated}`,
    newId: () => `note-${++notes}`,
    now: () => new Date("2026-10-13T00:00:00.000Z"),
  });
  return { app, lines, writing: started.promise, release: gate.resolve };
}

/** A request as Lambda forwards it: with the ID it assigned. */
export const as = (requestId: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: {
    ...(init.headers as Record<string, string> | undefined),
    [REQUEST_ID_HEADER]: requestId,
  },
});

export const createNote = (title: string): RequestInit => ({
  method: "POST",
  body: JSON.stringify({ title, body: "" }),
});

/** The request the audit line names as the one that stored this note. */
export const storedBy = (lines: LogEntry[], noteId: string): unknown =>
  lines.find((line) => line.message === "note stored" && line["noteId"] === noteId)?.["requestId"];
