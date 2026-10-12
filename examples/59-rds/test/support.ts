import { randomUUID } from "node:crypto";

import type { Note } from "@aih/example-13-sql/src/contract.ts";
import type { Db } from "@aih/example-13-sql/src/db.ts";
import { migrate } from "@aih/example-13-sql/src/migrate.ts";
import { SqlNoteRepository } from "@aih/example-13-sql/src/notes-repository.ts";
import { createTransactionRunner } from "@aih/example-13-sql/src/transaction.ts";

import { chapter13Migrations } from "../src/migrations.ts";
import { createReplicationModel, type ReplicationModel } from "../src/model/replication.ts";

export const migrationOptions = {
  dialect: "postgres",
  now: () => new Date("2026-10-13T00:00:00.000Z"),
  sleep: () => Promise.resolve(),
  log: () => undefined,
} as const;

/** A primary with chapter 13's schema and a replica that has replayed all of it. */
export async function migratedModel(): Promise<ReplicationModel> {
  const model = await createReplicationModel();
  await model.primary.withConnection((connection) =>
    migrate(connection, chapter13Migrations(), migrationOptions),
  );
  await model.replay();
  return model;
}

export const repositoryOn = (db: Db): SqlNoteRepository =>
  new SqlNoteRepository(
    createTransactionRunner({
      db,
      policy: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
      sleep: () => Promise.resolve(),
      random: () => 0,
    }),
    100,
  );

export const noteNamed = (title: string): Note => ({
  id: randomUUID(),
  title,
  body: "",
  version: 1,
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
});

/** A session on the same database that acts as `role` and gives the session back as it was. */
export const asRole = (db: Db, role: string): Db => ({
  close: () => Promise.resolve(),
  withConnection: (use) =>
    db.withConnection(async (connection) => {
      await connection.query(`SET ROLE ${role}`);
      try {
        return await use(connection);
      } finally {
        // A failed statement outside a transaction leaves nothing to roll back.
        await connection.query("RESET ROLE");
      }
    }),
});
