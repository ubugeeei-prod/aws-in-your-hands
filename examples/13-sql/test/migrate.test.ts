import { describe, expect, it } from "vite-plus/test";
import type { Db, Queryable } from "../src/db.ts";
import {
  lintMigration,
  loadMigrations,
  type MigrateDeps,
  type Migration,
  migrate,
  pendingMigrations,
  statementFor,
} from "../src/migrate.ts";
import { openPglite } from "../src/pglite.ts";
import { migrationsDirectory } from "./support.ts";

const deps = (dialect: MigrateDeps["dialect"]): MigrateDeps & { lines: string[] } => {
  const lines: string[] = [];
  return {
    dialect,
    now: () => new Date("2026-10-11T00:00:00.000Z"),
    sleep: () => Promise.resolve(),
    log: (line) => void lines.push(line),
    lines,
  };
};

const migration = (sql: string, name = "0001_test.sql"): Migration => ({ name, sql });

async function withDb<T>(use: (db: Db) => Promise<T>): Promise<T> {
  const db = await openPglite();
  try {
    return await use(db);
  } finally {
    await db.close();
  }
}

describe("migration files", () => {
  it("are each one idempotent statement that Aurora DSQL accepts", () => {
    const migrations = loadMigrations(migrationsDirectory);
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.flatMap(lintMigration)).toEqual([]);
  });

  it.each([
    ["CREATE TABLE IF NOT EXISTS a (id uuid PRIMARY KEY); INSERT INTO a VALUES (gen_random_uuid());", "2 statements"],
    ["CREATE TABLE IF NOT EXISTS a (id uuid PRIMARY KEY)", "ending in a semicolon"],
    ["BEGIN;", "transaction control"],
    ["CREATE INDEX IF NOT EXISTS a_idx ON a (id);", "without ASYNC"],
    ["CREATE UNIQUE INDEX a_idx ON a (id);", "without ASYNC"],
    ["CREATE INDEX ASYNC a_idx ON a (id);", "IF NOT EXISTS"],
    ["CREATE TABLE a (id uuid PRIMARY KEY);", "IF NOT EXISTS"],
    ["TRUNCATE a;", "TRUNCATE"],
    ["CREATE TEMP TABLE IF NOT EXISTS a (id uuid);", "temporary table"],
    ["CREATE TRIGGER t BEFORE INSERT ON a EXECUTE FUNCTION f();", "trigger"],
    ["CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;", "PL/pgSQL"],
  ])("rejects %s", (sql, problem) => {
    expect(lintMigration(migration(sql)).join("\n")).toContain(problem);
  });

  it("is not fooled by a semicolon or a keyword inside a string or a comment", () => {
    const sql = "-- TRUNCATE; would be wrong\nUPDATE app.notes SET body = 'BEGIN; TRUNCATE' WHERE body = '';\n";
    expect(lintMigration(migration(sql))).toEqual([]);
  });

  it("drops ASYNC for PostgreSQL and keeps it for Aurora DSQL", () => {
    const index = migration("-- why\nCREATE INDEX ASYNC IF NOT EXISTS a_idx ON a (id);\n");
    expect(statementFor("dsql", index)).toBe("CREATE INDEX ASYNC IF NOT EXISTS a_idx ON a (id)");
    expect(statementFor("postgres", index)).toBe("CREATE INDEX IF NOT EXISTS a_idx ON a (id)");
  });
});

// Each test boots its own PGlite, which takes a second or more on a busy machine.
describe("migrate on PostgreSQL", { timeout: 60_000 }, () => {
  it("applies every migration once, in order", async () => {
    await withDb(async (db) => {
      const migrations = loadMigrations(migrationsDirectory);
      const names = migrations.map((item) => item.name);

      expect(await db.withConnection((connection) => pendingMigrations(connection, migrations))).toEqual(names);
      expect(await db.withConnection((connection) => migrate(connection, migrations, deps("postgres")))).toEqual({
        applied: names,
      });
      expect(await db.withConnection((connection) => migrate(connection, migrations, deps("postgres")))).toEqual({
        applied: [],
      });
      expect(await db.withConnection((connection) => pendingMigrations(connection, migrations))).toEqual([]);
    });
  });

  // #region interrupted
  it("finishes on the next run when it stopped between applying and recording", async () => {
    await withDb(async (db) => {
      const migrations = loadMigrations(migrationsDirectory);
      const interrupted = migrations[2]?.name;
      let crashed = false;
      // The process dies after the third schema change, before writing it down.
      const crashing = (connection: Queryable): Queryable => ({
        query(text, params) {
          if (!crashed && text.startsWith("INSERT INTO public.aih_migrations") && params?.[0] === interrupted) {
            crashed = true;
            throw new Error("process killed");
          }
          return connection.query(text, params);
        },
      });

      await expect(
        db.withConnection((connection) => migrate(crashing(connection), migrations, deps("postgres"))),
      ).rejects.toThrow("process killed");

      // The table exists but is unrecorded. Applying it again must not fail.
      const second = await db.withConnection((connection) => migrate(connection, migrations, deps("postgres")));
      expect(second.applied).toEqual(migrations.slice(2).map((item) => item.name));
      expect(await db.withConnection((connection) => pendingMigrations(connection, migrations))).toEqual([]);
    });
  });
  // #endregion interrupted

  it("refuses to go on when an applied migration was edited or removed", async () => {
    await withDb(async (db) => {
      const original = [
        migration("CREATE SCHEMA IF NOT EXISTS one;"),
        migration("CREATE SCHEMA IF NOT EXISTS two;", "0002_two.sql"),
      ];
      await db.withConnection((connection) => migrate(connection, original, deps("postgres")));

      const edited = [migration("CREATE SCHEMA IF NOT EXISTS uno;"), original[1] as Migration];
      await expect(db.withConnection((connection) => migrate(connection, edited, deps("postgres")))).rejects.toThrow(
        "0001_test.sql was edited",
      );
      await expect(
        db.withConnection((connection) => migrate(connection, original.slice(0, 1), deps("postgres"))),
      ).rejects.toThrow("0002_two.sql is recorded as applied but its file is gone");
    });
  });

  it("applies nothing at all when any file fails the lint", async () => {
    await withDb(async (db) => {
      const migrations = [migration("CREATE SCHEMA IF NOT EXISTS fine;"), migration("TRUNCATE a;", "0002_bad.sql")];
      await expect(
        db.withConnection((connection) => migrate(connection, migrations, deps("postgres"))),
      ).rejects.toThrow("Refusing to migrate");
      expect(await db.withConnection((connection) => pendingMigrations(connection, migrations))).toHaveLength(2);
    });
  });
});

// Aurora DSQL is not available locally. These check only what this code does
// with the job id that `CREATE INDEX ASYNC` is documented to return.
describe("migrate against a scripted Aurora DSQL session", () => {
  function scripted(statuses: { status: string; details: string | null }[]) {
    const sent: string[] = [];
    const connection: Queryable = {
      async query(text) {
        sent.push(text);
        if (text.startsWith("CREATE INDEX ASYNC")) {
          return { rows: [{ job_id: "job-1" }] };
        }
        if (text.startsWith("SELECT status")) {
          const next = statuses.shift();
          return { rows: next === undefined ? [] : [next] };
        }
        return { rows: [] };
      },
    };
    return { connection, sent };
  }
  const index = [migration("CREATE INDEX ASYNC IF NOT EXISTS a_idx ON a (id);")];

  it("waits for the index build before recording the migration", async () => {
    const { connection, sent } = scripted([
      { status: "submitted", details: null },
      { status: "processing", details: null },
      { status: "completed", details: null },
    ]);

    await migrate(connection, index, deps("dsql"));

    const polls = sent.filter((text) => text.startsWith("SELECT status")).length;
    const record = sent.findIndex((text) => text.startsWith("INSERT INTO public.aih_migrations"));
    expect(polls).toBe(3);
    expect(record).toBe(sent.length - 1);
    expect(sent).toContain("CREATE INDEX ASYNC IF NOT EXISTS a_idx ON a (id)");
  });

  it("does not record a migration whose index build failed", async () => {
    const { connection, sent } = scripted([
      { status: "failed", details: "Found duplicate key while validating index" },
    ]);

    await expect(migrate(connection, index, deps("dsql"))).rejects.toThrow("Found duplicate key");
    expect(sent.some((text) => text.startsWith("INSERT INTO public.aih_migrations"))).toBe(false);
  });
});
