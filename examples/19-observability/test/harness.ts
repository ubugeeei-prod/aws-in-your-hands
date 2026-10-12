import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { InMemoryNoteRepository } from "@aih/example-05-dynamodb/src/memory-repository.ts";
import type { NoteRepository } from "@aih/example-05-dynamodb/src/repository.ts";

import { createObservedApp } from "../src/app.ts";
import { type LogLine, parseLogLines } from "../src/log-shape.ts";

export const requestIdOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A table whose `list` fails, to produce a 500 on demand. */
export function brokenList(message: string): NoteRepository {
  const repository = new InMemoryNoteRepository();
  repository.list = () => Promise.reject(new Error(message));
  return repository;
}

export function harness(options: { repository?: NoteRepository; msPerTick?: number } = {}) {
  const raw: string[] = [];
  let clock = Date.UTC(2026, 9, 12);
  let requests = 0;
  let suffix = 0;
  const app = createObservedApp({
    env: {
      ALLOWED_ORIGIN: "http://localhost:5173",
      LOG_LEVEL: "debug",
      STAGE: "test",
      NOTES_STORE: "memory",
    },
    repository: options.repository ?? new InMemoryNoteRepository(),
    // The real logger, so the lines are the bytes CloudWatch Logs would get.
    log: createLogger("debug", (line) => raw.push(line)),
    newRequestId: () => requestIdOf(++requests),
    // Every reading of the clock moves it, so durations are known in advance.
    now: () => (clock += options.msPerTick ?? 7),
    randomSuffix: () => String(++suffix).padStart(4, "0"),
  });

  const send = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app(
      new Request(`http://api.test${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  return { app, send, raw, lines: (): LogLine[] => parseLogLines(raw) };
}
