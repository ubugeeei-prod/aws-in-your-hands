import { randomUUID } from "node:crypto";

import * as v from "valibot";

import { type Db, rows } from "@aih/example-13-sql/src/db.ts";
import { migrate } from "@aih/example-13-sql/src/migrate.ts";
import { openPglite } from "@aih/example-13-sql/src/pglite.ts";
import type { RetryPolicy } from "@aih/example-13-sql/src/transaction.ts";

import { ConnectionLostError } from "../src/failure.ts";
import { allMigrations } from "../src/migrations.ts";
import { createOnce, type Transactional } from "../src/once.ts";

export const AT = new Date("2026-10-13T00:00:00.000Z");
export const policy: RetryPolicy = { maxAttempts: 4, baseDelayMs: 20, maxDelayMs: 500 };

/** An in-memory PostgreSQL (PGlite) with chapter 13's schema and this chapter's table. */
export async function migratedDb(): Promise<Db> {
  const db = await openPglite();
  await db.withConnection((connection) =>
    migrate(connection, allMigrations(), {
      dialect: "postgres",
      now: () => AT,
      sleep: () => Promise.resolve(),
      log: () => undefined,
    }),
  );
  return db;
}

/** A note with the body "a" at version 1, under an owner of its own. */
export async function seedNote(db: Db): Promise<{ owner: string; id: string }> {
  const owner = `owner-${randomUUID()}`;
  const id = randomUUID();
  await db.withConnection(async (connection) => {
    await connection.query("INSERT INTO app.owners (owner, note_count) VALUES ($1, 1)", [owner]);
    await connection.query(
      "INSERT INTO app.notes (id, owner, title, body, version, created_at, updated_at) VALUES ($1, $2, 'title', 'a', 1, $3, $3)",
      [id, owner, AT.toISOString()],
    );
  });
  return { owner, id };
}

const stateSchema = v.object({
  body: v.string(),
  version: v.number(),
  requests: v.number(),
});

/** What is stored: the note, and how many requests are recorded for its owner. */
export async function stored(db: Db, note: { owner: string; id: string }) {
  const [state] = await db.withConnection((connection) =>
    rows(
      connection,
      stateSchema,
      `SELECT body, version,
         (SELECT count(*)::integer FROM app.requests WHERE owner = $1) AS requests
       FROM app.notes WHERE owner = $1 AND id = $2`,
      [note.owner, note.id],
    ),
  );
  if (state === undefined) {
    throw new Error("The seeded note is gone.");
  }
  return state;
}

// #region drop
export type Drop = { statement: number; when: "before" | "after" };

/**
 * Loses the session once, at one statement counted from the first the
 * database is sent. "before": the statement never arrives. "after": it runs,
 * and the answer is what gets lost. Either way the server ends the session,
 * which rolls back whatever was not committed, and the client hears nothing.
 */
export function dropping(db: Db, drop: Drop | undefined): Db & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    close: () => db.close(),
    withConnection: (use) =>
      db.withConnection((connection) => {
        let lost = false;
        return use({
          async query(text, params) {
            if (lost) {
              throw new ConnectionLostError("This session was already lost.");
            }
            statements.push(text);
            if (statements.length !== drop?.statement) {
              return connection.query(text, params);
            }
            lost = true;
            if (drop.when === "after") {
              await connection.query(text, params);
            }
            if (drop.when === "before" || text !== "COMMIT") {
              await connection.query("ROLLBACK");
            }
            throw new ConnectionLostError(`Dropped ${drop.when} statement ${drop.statement}.`);
          },
        });
      }),
  };
}
// #endregion drop

/** A runner that never really sleeps, and records what it would have waited. */
export function onceFor(database: Transactional, retryPolicy: RetryPolicy = policy) {
  const sleeps: number[] = [];
  const once = createOnce({
    database,
    policy: retryPolicy,
    now: () => AT,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
  });
  return { once, sleeps };
}
