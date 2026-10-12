import { randomBytes, randomUUID } from "node:crypto";

import { createRepository } from "@aih/example-05-dynamodb/src/compose.ts";
import { parseEnv } from "@aih/example-05-dynamodb/src/env.ts";
import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";

import { type App, createApp } from "./app.ts";
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
      repository: createRepository(env),
      now: () => new Date(),
      randomSuffix: () => randomBytes(5).toString("hex"),
    }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
