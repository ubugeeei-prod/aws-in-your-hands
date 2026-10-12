import { randomBytes, randomUUID } from "node:crypto";

import { createRepository } from "@aih/example-05-dynamodb/src/compose.ts";
import { parseEnv } from "@aih/example-05-dynamodb/src/env.ts";
import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";

import { type App, createApp } from "./app.ts";
import { MAX_NOTES_PER_OWNER } from "./contract.ts";
import type { Authenticate } from "./identity.ts";

/** Only `authenticate` differs between entry points. The rest is chapter 05's. */
export function composeApp(
  source: Record<string, string | undefined>,
  authenticate: Authenticate,
): App {
  const env = parseEnv(source);
  return createApp({
    env,
    authenticate,
    log: createLogger(env.LOG_LEVEL),
    notes: createNoteService({
      // Chapter 05 counted one shared owner. The owner is now the caller, so the limit is per user.
      repository: createRepository(env, MAX_NOTES_PER_OWNER),
      now: () => new Date(),
      randomSuffix: () => randomBytes(5).toString("hex"),
    }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
