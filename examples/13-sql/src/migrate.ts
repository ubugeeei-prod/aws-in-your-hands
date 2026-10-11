import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { type Queryable, rows, sqlStateOf } from "./db.ts";

export type Migration = { name: string; sql: string };
export type Dialect = "dsql" | "postgres";

const FILE_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Every .sql file in `directory`, in the order of the number each name starts with. */
export function loadMigrations(directory: string): Migration[] {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .toSorted();
  for (const name of names) {
    if (!FILE_NAME.test(name)) {
      throw new Error(`Migration file name ${name} is not of the form 0001_what_it_does.sql`);
    }
  }
  return names.map((name) => ({ name, sql: readFileSync(join(directory, name), "utf8") }));
}

export const checksumOf = (migration: Migration): string => createHash("sha256").update(migration.sql).digest("hex");

/** The SQL without `--` comments. String literals are kept as they are. */
function withoutComments(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'|--[^\n]*/g, (match) => (match.startsWith("'") ? match : ""));
}

const withoutLiterals = (sql: string): string => sql.replace(/'(?:[^']|'')*'/g, "''");

// #region lint
// What the local PostgreSQL accepts and Aurora DSQL does not, plus one house
// rule (one idempotent statement per file). Checked on the text, so a
// migration that could only ever work locally fails in `vp run test:unit`.
const RULES: { pattern: RegExp; problem: string }[] = [
  {
    pattern: /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/i,
    problem: "has transaction control; the runner runs each file as one transaction",
  },
  { pattern: /\$\$/, problem: "uses dollar quoting, which the one-statement check cannot see through" },
  {
    pattern: /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!ASYNC\b)/i,
    problem: "creates an index without ASYNC; Aurora DSQL only builds indexes asynchronously",
  },
  { pattern: /\bTRUNCATE\b/i, problem: "uses TRUNCATE; Aurora DSQL has DELETE FROM instead" },
  { pattern: /\bCREATE\s+(GLOBAL\s+|LOCAL\s+)?(TEMP|TEMPORARY)\b/i, problem: "creates a temporary table" },
  { pattern: /\bCREATE\s+(OR\s+REPLACE\s+)?(CONSTRAINT\s+)?TRIGGER\b/i, problem: "creates a trigger" },
  { pattern: /\bLANGUAGE\s+plpgsql\b/i, problem: "uses PL/pgSQL; Aurora DSQL functions are LANGUAGE SQL" },
  {
    pattern: /\bCREATE\s+(TABLE|SCHEMA|(UNIQUE\s+)?INDEX\s+ASYNC)\s+(?!IF\s+NOT\s+EXISTS\b)/i,
    problem: "creates without IF NOT EXISTS, so applying it a second time would fail",
  },
];

export function lintMigration(migration: Migration): string[] {
  const text = withoutLiterals(withoutComments(migration.sql)).trim();
  const problems = RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.problem);
  // Aurora DSQL allows one DDL statement per transaction, and never DDL and
  // DML together. One statement per file makes both true by construction.
  const statements = text.split(";").filter((part) => part.trim() !== "");
  if (statements.length !== 1 || !text.endsWith(";")) {
    problems.push(`has ${statements.length} statements; a migration is exactly one, ending in a semicolon`);
  }
  return problems.map((problem) => `${migration.name} ${problem}`);
}
// #endregion lint

// #region dialect
/** The statement to send. PostgreSQL does not know DSQL's `CREATE INDEX ASYNC`. */
export function statementFor(dialect: Dialect, migration: Migration): string {
  const statement = withoutComments(migration.sql).trim().replace(/;$/, "");
  return dialect === "dsql" ? statement : statement.replace(/\b(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+ASYNC\b/i, "$1");
}
// #endregion dialect

const appliedRowSchema = z.object({ name: z.string(), checksum: z.string() });
const jobIdRowSchema = z.object({ job_id: z.string().min(1) });
const jobRowSchema = z.object({ status: z.string(), details: z.string().nullable() });

export type MigrateDeps = {
  dialect: Dialect;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
};

// `CREATE INDEX ASYNC` returns at once with a job id. The index is not there
// yet, and a failed build leaves an invalid index behind, so wait and look.
async function waitForJob(connection: Queryable, jobId: string, deps: MigrateDeps): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const [job] = await rows(connection, jobRowSchema, "SELECT status, details FROM sys.jobs WHERE job_id = $1", [
      jobId,
    ]);
    if (job === undefined) {
      throw new Error(`Job ${jobId} is not in sys.jobs. Check the index with pg_index.indisvalid before going on.`);
    }
    if (job.status === "completed") {
      return;
    }
    if (job.status === "failed") {
      throw new Error(`Job ${jobId} failed: ${job.details ?? "no details"}. Drop the invalid index before retrying.`);
    }
    await deps.sleep(1000);
  }
  throw new Error(`Job ${jobId} did not finish in time. Look at sys.jobs.`);
}

// #region migrate
export async function migrate(
  connection: Queryable,
  migrations: Migration[],
  deps: MigrateDeps,
): Promise<{ applied: string[] }> {
  const problems = migrations.flatMap(lintMigration);
  if (problems.length > 0) {
    throw new Error(`Refusing to migrate:\n  ${problems.join("\n  ")}`);
  }

  await connection.query(
    "CREATE TABLE IF NOT EXISTS public.aih_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL)",
  );
  const recorded = await rows(connection, appliedRowSchema, "SELECT name, checksum FROM public.aih_migrations");
  const checksums = new Map(recorded.map((row) => [row.name, row.checksum]));
  for (const name of checksums.keys()) {
    if (!migrations.some((migration) => migration.name === name)) {
      throw new Error(`${name} is recorded as applied but its file is gone.`);
    }
  }

  const applied: string[] = [];
  for (const migration of migrations) {
    const recordedChecksum = checksums.get(migration.name);
    if (recordedChecksum !== undefined) {
      if (recordedChecksum !== checksumOf(migration)) {
        throw new Error(`${migration.name} was edited after it was applied. Add a new migration instead.`);
      }
      continue;
    }
    // No BEGIN: each statement is its own transaction. The schema change and
    // the record of it cannot share one, because DDL and DML may not mix.
    const result = await connection.query(statementFor(deps.dialect, migration));
    const job = jobIdRowSchema.safeParse(result.rows[0]);
    if (deps.dialect === "dsql" && job.success) {
      await waitForJob(connection, job.data.job_id, deps);
    }
    // A crash before this line leaves the migration applied but unrecorded.
    // The next run applies it again, which IF NOT EXISTS makes harmless.
    await connection.query(
      "INSERT INTO public.aih_migrations (name, checksum, applied_at) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING",
      [migration.name, checksumOf(migration), deps.now().toISOString()],
    );
    deps.log(`applied ${migration.name}`);
    applied.push(migration.name);
  }
  return { applied };
}
// #endregion migrate

/** Names of migrations that have not been recorded. An unmigrated database has all of them. */
export async function pendingMigrations(connection: Queryable, migrations: Migration[]): Promise<string[]> {
  let recorded: { name: string }[];
  try {
    recorded = await rows(connection, appliedRowSchema, "SELECT name, checksum FROM public.aih_migrations");
  } catch (error) {
    // 42P01, undefined_table: nothing has ever been applied.
    if (sqlStateOf(error) !== "42P01") {
      throw error;
    }
    recorded = [];
  }
  const names = new Set(recorded.map((row) => row.name));
  return migrations.filter((migration) => !names.has(migration.name)).map((migration) => migration.name);
}
