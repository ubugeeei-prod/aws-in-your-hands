import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { type Db, sqlStateOf } from "@aih/example-13-sql/src/db.ts";
import { openPglite } from "@aih/example-13-sql/src/pglite.ts";

import { chapter13Migrations } from "../src/migrations.ts";
import { type OpsDeps, runCommand } from "../src/ops.ts";
import { API_ROLE, apiGrantStatements, bootstrapStatements, MIGRATOR_ROLE } from "../src/roles.ts";
import { asRole, noteNamed, repositoryOn } from "./support.ts";

// One PostgreSQL (PGlite) stands in for the instance. Its only session is a
// superuser, which plays the master user; `SET ROLE` plays signing in as someone else.
let db: Db;
const logged: string[] = [];
let deps: OpsDeps;
const MASTER = { username: "notes_admin", password: "correct horse battery staple" };

beforeAll(async () => {
  db = await openPglite();
  // On Amazon RDS this role exists already. Granting it is what switches a user to IAM tokens.
  await db.withConnection((connection) => connection.query("CREATE ROLE rds_iam"));
  const shared: Db = { withConnection: (use) => db.withConnection(use), close: async () => {} };
  deps = {
    database: "postgres",
    asMaster: () => shared,
    asMigrator: () => asRole(db, MIGRATOR_ROLE),
    now: () => new Date("2026-10-13T00:00:00.000Z"),
    sleep: () => Promise.resolve(),
    log: (line) => logged.push(line),
  };
}, 60_000);
afterAll(() => db.close());

const refused = async (role: string, statement: string): Promise<string | undefined> =>
  sqlStateOf(
    await asRole(db, role)
      .withConnection((connection) => connection.query(statement))
      .catch((error: unknown) => error),
  );

describe("the operations function, on a local PostgreSQL", () => {
  // #region least-privilege
  it("creates the two roles once, migrates as one, and leaves the other with rows only", async () => {
    expect(await runCommand({ action: "bootstrap", master: MASTER }, deps)).toEqual({
      created: [`CREATE ROLE ${MIGRATOR_ROLE} LOGIN`, `CREATE ROLE ${API_ROLE} LOGIN`],
    });
    const migrations = chapter13Migrations();
    expect(await runCommand({ action: "migrate", migrations }, deps)).toEqual({
      applied: migrations.map((migration) => migration.name),
    });

    // The API's role does what the application does.
    const notes = repositoryOn(asRole(db, API_ROLE));
    const note = noteNamed("through notes_api");
    expect(await notes.create("owner", note)).toBe("created");
    expect(await notes.get("owner", note.id)).toEqual(note);

    // 42501, insufficient_privilege: it changes no schema, and does not see the migration record.
    expect(await refused(API_ROLE, "DROP TABLE app.notes")).toBe("42501");
    expect(await refused(API_ROLE, "ALTER TABLE app.notes ADD COLUMN pinned boolean")).toBe(
      "42501",
    );
    expect(await refused(API_ROLE, "CREATE TABLE app.extra (id integer)")).toBe("42501");
    expect(await refused(API_ROLE, "SELECT * FROM public.aih_migrations")).toBe("42501");
    // The migrator owns the schema it created, and is not an administrator.
    expect(await refused(MIGRATOR_ROLE, "CREATE ROLE intruder LOGIN")).toBe("42501");
    expect(await refused(MIGRATOR_ROLE, "CREATE DATABASE elsewhere")).toBe("42501");
  });
  // #endregion least-privilege

  it("changes nothing when either command runs a second time", async () => {
    expect(await runCommand({ action: "bootstrap", master: MASTER }, deps)).toEqual({
      created: [],
    });
    expect(
      await runCommand({ action: "migrate", migrations: chapter13Migrations() }, deps),
    ).toEqual({ applied: [] });
  });

  it("covers a table created by a later migration without another grant", async () => {
    await asRole(db, MIGRATOR_ROLE).withConnection((connection) =>
      connection.query("CREATE TABLE app.tags (name text PRIMARY KEY)"),
    );
    expect(await refused(API_ROLE, "INSERT INTO app.tags VALUES ('later')")).toBeUndefined();
  });

  it("reports who it is connected as", async () => {
    expect(await runCommand({ action: "status" }, deps)).toMatchObject({
      role: MIGRATOR_ROLE,
      replica: false,
      // PGlite has no network connection, so there is no TLS to report.
      tls: null,
    });
  });

  it("never writes the master password to its log", async () => {
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join("\n")).not.toContain(MASTER.password);
  });

  it("refuses a command it does not know, before opening a connection", async () => {
    const closed: OpsDeps = {
      ...deps,
      asMaster: () => {
        throw new Error("opened a connection");
      },
      asMigrator: () => {
        throw new Error("opened a connection");
      },
    };
    for (const command of [
      { action: "drop" },
      { action: "status", sql: "DROP TABLE app.notes" },
      { action: "bootstrap", master: { username: "notes_admin" } },
      { action: "migrate", migrations: [] },
      { action: "migrate", migrations: [{ name: "../../etc/passwd", sql: "SELECT 1;" }] },
    ]) {
      await expect(runCommand(command, closed), JSON.stringify(command)).rejects.toThrow(/Invalid/);
    }
  });

  it("refuses a migration that breaks chapter 13's rules", async () => {
    const migrations = [
      {
        name: "0005_two_statements.sql",
        sql: "CREATE TABLE IF NOT EXISTS app.a (n integer); DROP TABLE app.notes;",
      },
    ];
    await expect(runCommand({ action: "migrate", migrations }, deps)).rejects.toThrow(
      /Refusing to migrate/,
    );
    expect(await refused(API_ROLE, "SELECT count(*) FROM app.notes")).toBeUndefined();
  });
});

describe("statements that carry names in their text", () => {
  it("lets through plain identifiers only", () => {
    expect(bootstrapStatements("notes").grant).toContain(
      `GRANT CREATE ON DATABASE notes TO ${MIGRATOR_ROLE}`,
    );
    for (const name of ["notes; DROP ROLE notes_api", 'no"tes', "Notes", "", "1notes", "a b"]) {
      expect(() => bootstrapStatements(name), name).toThrow(/identifier/);
      expect(() => apiGrantStatements(name), name).toThrow(/identifier/);
    }
  });
});
