import { type Db, type Queryable, sqlStateOf } from "./db.ts";

// #region policy
export type RetryPolicy = { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };

export const defaultRetryPolicy: RetryPolicy = { maxAttempts: 4, baseDelayMs: 20, maxDelayMs: 500 };

// SQLSTATE 40001, serialization_failure. Aurora DSQL reports both of its
// commit-time conflicts with it (OC000 data, OC001 schema), and PostgreSQL
// reports a concurrent update under REPEATABLE READ the same way.
export function isSerializationFailure(error: unknown): boolean {
  return sqlStateOf(error) === "40001";
}

/** Full jitter: a random wait below an exponentially growing cap. */
export function backoffMs(attempt: number, policy: RetryPolicy, random: () => number): number {
  const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(random() * cap);
}

export class RetriesExhaustedError extends Error {
  constructor(attempts: number, cause: unknown) {
    super(`The transaction conflicted ${attempts} times and was not committed.`, { cause });
    this.name = "RetriesExhaustedError";
  }
}
// #endregion policy

// #region run
export type TransactionDeps = {
  db: Db;
  policy: RetryPolicy;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
};

export type TransactionRunner = <T>(body: (tx: Queryable) => Promise<T>) => Promise<T>;

/**
 * Runs `body` in a transaction. After a serialization failure the whole body
 * runs again from BEGIN, so it must reach its decisions only by what it reads
 * through `tx`, and must do nothing outside the database.
 */
export function createTransactionRunner(deps: TransactionDeps): TransactionRunner {
  return async (body) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await deps.db.withConnection(async (tx) => {
          // Aurora DSQL has only this level. Asking for it by name keeps
          // PostgreSQL, whose default is READ COMMITTED, on the same one.
          await tx.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
          try {
            const result = await body(tx);
            await tx.query("COMMIT");
            return result;
          } catch (error) {
            // After a failed COMMIT there is nothing left to roll back, and
            // the error worth reporting is the first one.
            await tx.query("ROLLBACK").catch(() => undefined);
            throw error;
          }
        });
      } catch (error) {
        if (!isSerializationFailure(error)) {
          throw error;
        }
        if (attempt >= deps.policy.maxAttempts) {
          throw new RetriesExhaustedError(attempt, error);
        }
        const delayMs = backoffMs(attempt, deps.policy, deps.random);
        deps.onRetry?.({ attempt, delayMs, error });
        await deps.sleep(delayMs);
      }
    }
  };
}
// #endregion run
