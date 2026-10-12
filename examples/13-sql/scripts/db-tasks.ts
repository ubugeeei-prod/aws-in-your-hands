// Shared by local-db.ts and cloud-db.ts: the same migrations and the same
// seed, whichever database they are pointed at.

import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import * as v from "valibot";

import { MAX_NOTES_PER_OWNER, noteSchema } from "../src/contract.ts";
import type { Db } from "../src/db.ts";
import { type Dialect, loadMigrations, migrate } from "../src/migrate.ts";
import { SqlNoteRepository } from "../src/notes-repository.ts";
import { SHARED_OWNER } from "../src/notes.ts";
import { createTransactionRunner, defaultRetryPolicy } from "../src/transaction.ts";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export async function runMigrations(db: Db, dialect: Dialect): Promise<void> {
  const migrations = loadMigrations(here("../migrations"));
  const { applied } = await db.withConnection((connection) =>
    migrate(connection, migrations, {
      dialect,
      now: () => new Date(),
      sleep: (ms) => sleep(ms),
      log: console.log,
    }),
  );
  console.log(applied.length === 0 ? "nothing to apply" : `applied ${applied.length} migration(s)`);
}

export async function runSeed(db: Db): Promise<void> {
  const fixture = v.parse(
    v.array(noteSchema),
    JSON.parse(readFileSync(here("../test/fixtures/seed-notes.json"), "utf8")),
  );
  const transaction = createTransactionRunner({
    db,
    policy: defaultRetryPolicy,
    sleep: (ms) => sleep(ms),
    random: Math.random,
  });
  const repository = new SqlNoteRepository(transaction, MAX_NOTES_PER_OWNER);
  // The ids are fixed in the fixture, so seeding twice changes nothing.
  for (const note of fixture) {
    const result = await repository.create(SHARED_OWNER, note);
    console.log(`${result === "created" ? "ok  " : "FULL"} ${note.id} ${note.title}`);
  }
}
