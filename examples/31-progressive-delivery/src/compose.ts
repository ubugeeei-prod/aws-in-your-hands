import { randomUUID } from "node:crypto";

import { createApp } from "@aih/example-04-http-api/src/app.ts";
import { parseEnv } from "@aih/example-04-http-api/src/env.ts";
import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createLogger } from "@aih/example-04-http-api/src/log.ts";
import { createNoteService, InMemoryNoteRepository } from "@aih/example-04-http-api/src/notes.ts";

import { createRolloutApp } from "./app.ts";
import { parseRolloutEnv } from "./env.ts";
import { createFlagReader, extensionSource, fileSource } from "./flags/reader.ts";

// #region compose
export function composeRollout(
  source: Record<string, string | undefined>,
  fetchFlags: typeof fetch = fetch,
): Fetch {
  const env = parseEnv(source);
  const rollout = parseRolloutEnv(source);
  const log = createLogger(env.LOG_LEVEL);
  const repository = new InMemoryNoteRepository();

  const readFlags = createFlagReader(
    rollout.flags.from === "file"
      ? fileSource(rollout.flags.path)
      : extensionSource(rollout.flags, fetchFlags),
    (origin, error) =>
      log({
        level: origin === "live" ? "info" : "warn",
        message: "flags",
        origin,
        ...(error === undefined
          ? {}
          : { error: error instanceof Error ? error.message : String(error) }),
      }),
  );

  return createRolloutApp({
    inner: createApp({
      env,
      log,
      notes: createNoteService({ repository, now: () => new Date(), newId: randomUUID }),
      newRequestId: randomUUID,
      now: Date.now,
    }),
    readFlags,
    countNotes: async () => (await repository.list()).length,
    version: rollout.version,
    allowedOrigin: env.ALLOWED_ORIGIN,
    faultPercent: rollout.faultPercent,
    random: Math.random,
    newRequestId: randomUUID,
  });
}
// #endregion compose
