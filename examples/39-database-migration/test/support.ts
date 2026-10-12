import { PGlite } from "@electric-sql/pglite";
import { vi } from "vite-plus/test";

import type { Queryable } from "@aih/example-13-sql/src/db.ts";

import { type Table, readCatalog } from "../src/catalog.ts";
import { installCapture } from "../src/model/capture.ts";
import type { Pair } from "../src/model/replicate.ts";
import { runSqlDirectory } from "../src/sql-file.ts";
import { resolveMappings, tableMappings } from "../src/table-mappings.ts";

// Each world starts two WebAssembly PostgreSQL instances, which takes seconds
// on a busy machine. The defaults (10 s for a hook, 5 s for a test) are too tight.
vi.setConfig({ hookTimeout: 60_000, testTimeout: 30_000 });

export type World = {
  source: Queryable;
  target: Queryable;
  /** The selected tables, parents first. */
  pairs: Pair[];
  catalog: Table[];
  close: () => Promise<void>;
};

const order = ["owners", "notes", "note_revisions", "audit_log"];

/**
 * Two in-memory PostgreSQL databases: the source with its schema (prepared or
 * as found), the target with the schema written for it, and capture running.
 */
export async function world(options: { prepared: boolean } = { prepared: true }): Promise<World> {
  // The same in-process PostgreSQL chapter 13 runs on, one instance per side.
  const sourceDb = await PGlite.create();
  const targetDb = await PGlite.create();
  const session = (db: PGlite): Queryable => ({
    query: async (text, params) => ({ rows: (await db.query(text, [...(params ?? [])])).rows }),
  });
  const source = session(sourceDb);
  const target = session(targetDb);

  await runSqlDirectory(source, "source", (file) => options.prepared || file.startsWith("0001"));
  await runSqlDirectory(target, "target");
  if (!options.prepared) {
    // The target as it would be if nobody had prepared anything either.
    await target.query("ALTER TABLE app.audit_log DROP COLUMN id");
  }

  const catalog = await readCatalog(source, ["public"]);
  const selected = resolveMappings(tableMappings, catalog).selected;
  const pairs = selected
    .map((pair) => ({
      source: catalog.find((table) => table.name === pair.source.name) as Table,
      target: pair.target,
    }))
    .toSorted((a, b) => order.indexOf(a.source.name) - order.indexOf(b.source.name));
  await installCapture(
    source,
    pairs.map((pair) => pair.source),
  );

  return {
    source,
    target,
    pairs,
    catalog,
    close: async () => {
      await sourceDb.close();
      await targetDb.close();
    },
  };
}

export const noteId = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-10-13T00:00:00.000Z";

/** The application writing to the old database. */
export function writer(db: Queryable, schema = "public") {
  return {
    owner: (owner: string) =>
      db.query(`INSERT INTO ${schema}.owners (owner, note_count) VALUES ($1, 0)`, [owner]),
    note: (n: number, owner: string, title: string, body = "") =>
      db.query(
        `INSERT INTO ${schema}.notes (id, owner, title, body, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, $5, $5)`,
        [noteId(n), owner, title, body, at],
      ),
    retitle: (n: number, title: string) =>
      db.query(`UPDATE ${schema}.notes SET title = $2, version = version + 1 WHERE id = $1`, [
        noteId(n),
        title,
      ]),
    remove: (n: number) => db.query(`DELETE FROM ${schema}.notes WHERE id = $1`, [noteId(n)]),
    revision: (n: number, version: number, title: string) =>
      db.query(
        `INSERT INTO ${schema}.note_revisions (note_id, version, title, saved_at) VALUES ($1, $2, $3, $4)`,
        [noteId(n), version, title, at],
      ),
    audit: (actor: string, action: string) =>
      db.query(`INSERT INTO ${schema}.audit_log (at, actor, action) VALUES ($1, $2, $3)`, [
        at,
        actor,
        action,
      ]),
  };
}

export async function seed(db: Queryable): Promise<void> {
  const write = writer(db);
  await write.owner("ada");
  await write.note(1, "ada", "first");
  await write.note(2, "ada", "second");
  await write.note(3, "ada", "third");
  await write.revision(1, 1, "first");
  await write.revision(2, 1, "second");
  await write.audit("ada", "created 3 notes");
}

export async function titles(db: Queryable, schema: string): Promise<string[]> {
  const result = await db.query(`SELECT title FROM ${schema}.notes ORDER BY id`);
  return (result.rows as { title: string }[]).map((row) => row.title);
}

export async function scalar(db: Queryable, text: string): Promise<unknown> {
  const result = await db.query(text);
  return Object.values((result.rows[0] ?? {}) as Record<string, unknown>)[0];
}
