import * as v from "valibot";

import { type Db, type Queryable, rows } from "@aih/example-13-sql/src/db.ts";
import { backoffMs, type RetryPolicy } from "@aih/example-13-sql/src/transaction.ts";

import { classify, type Failure } from "./failure.ts";

// #region port
/** One attempt: begin, run `body`, commit. Rolls back and rethrows when anything fails. */
export type Transactional = {
  transaction<T>(body: (tx: Queryable) => Promise<T>): Promise<T>;
};

/** A session of chapter 13's `Db` (PGlite, node-postgres) as one attempt. */
export function transactional(db: Db): Transactional {
  return {
    transaction: (body) =>
      db.withConnection(async (connection) => {
        // PostgreSQL's default level, READ COMMITTED. Chapter 13 asked for
        // REPEATABLE READ only to match Aurora DSQL, which has no other.
        await connection.query("BEGIN");
        try {
          const result = await body(connection);
          await connection.query("COMMIT");
          return result;
        } catch (error) {
          await connection.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      }),
  };
}
// #endregion port

export class AttemptsExhaustedError extends Error {
  constructor(attempts: number, cause: unknown) {
    super(`The request was attempted ${attempts} times and its outcome is not known.`, { cause });
    this.name = "AttemptsExhaustedError";
  }
}

/** Another transaction recorded the same key while this one was running. */
class KeyTakenError extends Error {}

const takenRowSchema = v.object({ key: v.string() });
const storedRowSchema = v.object({ result: v.string() });

// #region once
export type OnceRequest<T> = {
  owner: string;
  /** Chosen by the client, once per thing the user did. A retry sends it again. */
  key: string;
  /** What `body` returns. A replay is checked against it like any stored row. */
  result: v.GenericSchema<unknown, T>;
};

export type OnceDeps = {
  database: Transactional;
  policy: RetryPolicy;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; failure: Failure }) => void;
};

export type Once = <T>(request: OnceRequest<T>, body: (tx: Queryable) => Promise<T>) => Promise<T>;

/**
 * Runs `body` in a transaction that also records `key`. When an attempt ends
 * without an answer, the next one looks the key up first: found means the
 * earlier attempt was committed, and its result is returned without running
 * `body` again.
 */
export function createOnce(deps: OnceDeps): Once {
  return async (request, body) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await deps.database.transaction(async (tx) => {
          const [stored] = await rows(
            tx,
            storedRowSchema,
            "SELECT CAST(result AS text) AS result FROM app.requests WHERE owner = $1 AND key = $2",
            [request.owner, request.key],
          );
          if (stored !== undefined) {
            return v.parse(request.result, JSON.parse(stored.result));
          }
          const result = await body(tx);
          const recorded = await rows(
            tx,
            takenRowSchema,
            `INSERT INTO app.requests (owner, key, result, created_at)
             VALUES ($1, $2, CAST($3 AS jsonb), CAST($4 AS timestamptz))
             ON CONFLICT (owner, key) DO NOTHING RETURNING key`,
            [request.owner, request.key, JSON.stringify(result), deps.now().toISOString()],
          );
          if (recorded.length === 0) {
            // The work above happened twice. Throwing rolls this copy back.
            throw new KeyTakenError();
          }
          return result;
        });
      } catch (error) {
        const failure = error instanceof KeyTakenError ? "conflict" : classify(error);
        if (failure === "other") {
          throw error;
        }
        if (attempt >= deps.policy.maxAttempts) {
          throw new AttemptsExhaustedError(attempt, error);
        }
        const delayMs = backoffMs(attempt, deps.policy, deps.random);
        deps.onRetry?.({ attempt, delayMs, failure });
        await deps.sleep(delayMs);
      }
    }
  };
}
// #endregion once

// #region purge
/** Keys are only needed for as long as a client may still retry. */
export async function purgeRequests(tx: Queryable, olderThan: Date): Promise<number> {
  const purged = await rows(
    tx,
    takenRowSchema,
    "DELETE FROM app.requests WHERE created_at < CAST($1 AS timestamptz) RETURNING key",
    [olderThan.toISOString()],
  );
  return purged.length;
}
// #endregion purge
