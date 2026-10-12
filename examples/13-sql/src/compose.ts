import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { type App, createApp } from "./app.ts";
import { MAX_NOTES_PER_OWNER } from "./contract.ts";
import type { Db } from "./db.ts";
import type { Env } from "./env.ts";
import { createLogger } from "./log.ts";
import { SqlNoteRepository } from "./notes-repository.ts";
import { createNoteService } from "./notes.ts";
import { createTransactionRunner, defaultRetryPolicy } from "./transaction.ts";

// #region compose
/** The database is passed in: PGlite on a laptop, Aurora DSQL on Lambda. Everything else is the same. */
export function composeApp(env: Env, db: Db): App {
  const log = createLogger(env.LOG_LEVEL);
  const transaction = createTransactionRunner({
    db,
    policy: defaultRetryPolicy,
    sleep: (ms) => sleep(ms),
    random: Math.random,
    // How often this line appears is how contended the data is.
    onRetry: ({ attempt, delayMs, error }) =>
      log({ level: "warn", message: "transaction retry", attempt, delayMs, error: String(error) }),
  });
  return createApp({
    env,
    log,
    notes: createNoteService({
      repository: new SqlNoteRepository(transaction, MAX_NOTES_PER_OWNER),
      now: () => new Date(),
      newId: randomUUID,
    }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
// #endregion compose
