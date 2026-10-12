import { fileURLToPath } from "node:url";

import { z } from "zod";

import { type Db, type Queryable, rows } from "../src/db.ts";
import { loadMigrations, migrate } from "../src/migrate.ts";
import { openPglite } from "../src/pglite.ts";
import {
  createTransactionRunner,
  type RetryPolicy,
  type TransactionRunner,
} from "../src/transaction.ts";

export const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));

/** An in-memory PostgreSQL with every migration applied. One per test file; tests use separate owners. */
export async function migratedDb(): Promise<Db> {
  const db = await openPglite();
  await db.withConnection((connection) =>
    migrate(connection, loadMigrations(migrationsDirectory), {
      dialect: "postgres",
      now: () => new Date("2026-10-11T00:00:00.000Z"),
      sleep: () => Promise.resolve(),
      log: () => undefined,
    }),
  );
  return db;
}

export const testPolicy: RetryPolicy = { maxAttempts: 4, baseDelayMs: 20, maxDelayMs: 500 };

/** A runner that never really sleeps and records what it would have waited. */
export function runnerFor(db: Db, policy: RetryPolicy = testPolicy) {
  const sleeps: number[] = [];
  const transaction = createTransactionRunner({
    db,
    policy,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
  });
  return { transaction, sleeps };
}

// #region inject
export function serializationFailure(): Error {
  // The message and SQLSTATE Aurora DSQL documents for a data conflict.
  return Object.assign(new Error("change conflicts with another transaction (OC000)"), {
    code: "40001",
  });
}

/**
 * Makes the next `conflicts` COMMITs lose, the way optimistic concurrency
 * control makes them lose: the transaction is rolled back, `winner` commits
 * its own writes first, and only then does the loser hear SQLSTATE 40001.
 */
export function losingCommits(
  db: Db,
  plan: { conflicts: number; winner?: (transaction: TransactionRunner) => Promise<void> },
): Db & { commitsAttempted: () => number } {
  let remaining = plan.conflicts;
  let commitsAttempted = 0;
  return {
    commitsAttempted: () => commitsAttempted,
    close: () => db.close(),
    withConnection: (use) =>
      db.withConnection((connection) =>
        use({
          async query(text, params) {
            if (text !== "COMMIT") {
              return connection.query(text, params);
            }
            commitsAttempted++;
            if (remaining === 0) {
              return connection.query(text, params);
            }
            remaining--;
            await connection.query("ROLLBACK");
            // The winner runs on the same session, after the rollback.
            const session: Db = {
              withConnection: (run) => run(connection),
              close: () => Promise.resolve(),
            };
            await plan.winner?.(runnerFor(session).transaction);
            throw serializationFailure();
          },
        }),
      ),
  };
}
// #endregion inject

const countSchema = z.object({ n: z.number().int() });

/** What the owner row says, and what the table says. The invariant is that they agree. */
export async function counts(db: Db, owner: string): Promise<{ counted: number; stored: number }> {
  return db.withConnection(async (connection: Queryable) => {
    const [counted] = await rows(
      connection,
      countSchema,
      "SELECT coalesce(max(note_count), 0)::integer AS n FROM app.owners WHERE owner = $1",
      [owner],
    );
    const [stored] = await rows(
      connection,
      countSchema,
      "SELECT count(*)::integer AS n FROM app.notes WHERE owner = $1",
      [owner],
    );
    return { counted: counted?.n ?? 0, stored: stored?.n ?? 0 };
  });
}
