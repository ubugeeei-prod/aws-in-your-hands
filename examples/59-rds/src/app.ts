import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createApp } from "@aih/example-13-sql/src/app.ts";
import { MAX_NOTES_PER_OWNER } from "@aih/example-13-sql/src/contract.ts";
import type { Db } from "@aih/example-13-sql/src/db.ts";
import type { Logger } from "@aih/example-13-sql/src/log.ts";
import { SqlNoteRepository } from "@aih/example-13-sql/src/notes-repository.ts";
import { createNoteService } from "@aih/example-13-sql/src/notes.ts";
import {
  createTransactionRunner,
  defaultRetryPolicy,
} from "@aih/example-13-sql/src/transaction.ts";

import { formatLsn, LSN_MAX, parseLsn } from "./lsn.ts";
import type { ReplicationPosition } from "./position.ts";
import { routedRepository, type Session } from "./routing.ts";

/** The newest log position the caller has seen. Sent back with every request. */
export const SEEN_HEADER = "x-notes-seen";
/** Which instance answered a read. For looking, not for deciding. */
export const READ_FROM_HEADER = "x-notes-read-from";

export type RoutedAppDeps = {
  allowedOrigin: string;
  stage: string;
  /** What `/health` reports as the database. */
  database: string;
  primary: Db;
  replica?: { db: Db; position: ReplicationPosition };
  log: Logger;
  clock: () => Date;
  now: () => number;
  newId: () => string;
  newRequestId: () => string;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

// #region app
export function createRoutedApp(deps: RoutedAppDeps): Fetch {
  const repositoryOn = (db: Db) =>
    new SqlNoteRepository(
      createTransactionRunner({
        db,
        policy: defaultRetryPolicy,
        sleep: deps.sleep,
        random: deps.random,
      }),
      MAX_NOTES_PER_OWNER,
    );
  const primary = repositoryOn(deps.primary);
  const replica = deps.replica && {
    repository: repositoryOn(deps.replica.db),
    position: deps.replica.position,
  };

  return async (request) => {
    const header = request.headers.get(SEEN_HEADER);
    // A value that is not a position cannot be honoured, so the primary answers.
    const session: Session = { seen: header === null ? undefined : (parseLsn(header) ?? LSN_MAX) };

    // Chapter 13's application, around a repository that belongs to this request.
    const app = createApp({
      env: {
        ALLOWED_ORIGIN: deps.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: deps.stage,
        // Chapter 13's settings know two databases. Only its /health reads this, and
        // that answer is replaced below.
        NOTES_DB: "pglite",
        PGLITE_DATA_DIR: "unused",
      },
      notes: createNoteService({
        repository:
          replica === undefined
            ? primary
            : routedRepository({
                primary,
                replica: replica.repository,
                position: replica.position,
                session,
              }),
        now: deps.clock,
        newId: deps.newId,
      }),
      log: deps.log,
      newRequestId: deps.newRequestId,
      now: deps.now,
    });

    const answered = await app(request);
    const isHealth = new URL(request.url).pathname === "/health" && answered.status === 200;
    const response = isHealth
      ? Response.json(
          { status: "ok", stage: deps.stage, db: deps.database, replica: replica !== undefined },
          { headers: answered.headers },
        )
      : answered;

    if (session.seen !== undefined) {
      response.headers.set(SEEN_HEADER, formatLsn(session.seen));
    }
    if (session.readFrom !== undefined) {
      response.headers.set(READ_FROM_HEADER, session.readFrom);
    }
    // A page on the allowed origin must be able to send the position and read it back.
    if (request.method === "OPTIONS") {
      response.headers.append("access-control-allow-headers", SEEN_HEADER);
    } else {
      response.headers.set("access-control-expose-headers", `${SEEN_HEADER}, ${READ_FROM_HEADER}`);
    }
    return response;
  };
}
// #endregion app
