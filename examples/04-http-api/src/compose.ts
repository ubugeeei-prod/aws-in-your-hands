import { randomUUID } from "node:crypto";

import { type App, createApp } from "./app.ts";
import { parseEnv } from "./env.ts";
import { createLogger } from "./log.ts";
import { createNoteService, InMemoryNoteRepository } from "./notes.ts";

// #region compose
/** The one place that touches the real clock, real randomness, and the real environment. */
export function composeApp(source: Record<string, string | undefined>): App {
  const env = parseEnv(source);
  return createApp({
    env,
    log: createLogger(env.LOG_LEVEL),
    notes: createNoteService({
      repository: new InMemoryNoteRepository(),
      now: () => new Date(),
      newId: randomUUID,
    }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
// #endregion compose
