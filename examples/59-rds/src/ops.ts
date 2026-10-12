import * as v from "valibot";

import { type Db, rows, sqlStateOf } from "@aih/example-13-sql/src/db.ts";
import { migrate } from "@aih/example-13-sql/src/migrate.ts";

import { apiGrantStatements, bootstrapStatements } from "./roles.ts";

// #region command
const migrationSchema = v.object({
  name: v.pipe(v.string(), v.regex(/^\d{4}_[a-z0-9_]+\.sql$/)),
  sql: v.pipe(v.string(), v.minLength(1), v.maxLength(64 * 1024)),
});

/** What the operations function accepts. It is invoked directly, never through the API. */
export const commandSchema = v.variant("action", [
  v.strictObject({
    action: v.literal("bootstrap"),
    // The master user's credentials, read from Secrets Manager by the caller.
    master: v.strictObject({
      username: v.pipe(v.string(), v.minLength(1)),
      password: v.pipe(v.string(), v.minLength(1)),
    }),
  }),
  v.strictObject({
    action: v.literal("migrate"),
    migrations: v.pipe(v.array(migrationSchema), v.minLength(1), v.maxLength(500)),
  }),
  v.strictObject({ action: v.literal("status") }),
]);
export type Command = v.InferOutput<typeof commandSchema>;
// #endregion command

export type OpsDeps = {
  database: string;
  /** A session as the master user, with the password the command carried. */
  asMaster: (credentials: { username: string; password: string }) => Db;
  /** A session as the migrator role, signed in with an IAM token. */
  asMigrator: () => Db;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
};

const statusRowSchema = v.object({
  version: v.string(),
  role: v.string(),
  replica: v.boolean(),
  // No row in pg_stat_ssl means the session is not a network connection at all.
  tls: v.nullable(v.boolean()),
});

async function using<T>(db: Db, use: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await use(db);
  } finally {
    await db.close();
  }
}

// #region run
export async function runCommand(input: unknown, deps: OpsDeps): Promise<unknown> {
  const command = v.parse(commandSchema, input);
  switch (command.action) {
    case "bootstrap":
      return using(deps.asMaster(command.master), (db) =>
        db.withConnection(async (connection) => {
          const statements = bootstrapStatements(deps.database);
          const created: string[] = [];
          for (const statement of statements.create) {
            try {
              await connection.query(statement);
              created.push(statement);
            } catch (error) {
              // 42710, duplicate_object: an earlier run created this role.
              if (sqlStateOf(error) !== "42710") {
                throw error;
              }
            }
          }
          for (const statement of statements.grant) {
            await connection.query(statement);
          }
          return { created };
        }),
      );
    case "migrate":
      return using(deps.asMigrator(), (db) =>
        db.withConnection(async (connection) => {
          // Chapter 13's runner, lint included: these files must still run on Aurora DSQL.
          const { applied } = await migrate(connection, command.migrations, {
            dialect: "postgres",
            now: deps.now,
            sleep: deps.sleep,
            log: deps.log,
          });
          for (const statement of apiGrantStatements("app")) {
            await connection.query(statement);
          }
          return { applied };
        }),
      );
    case "status":
      return using(deps.asMigrator(), async (db) => {
        const [status] = await db.withConnection((connection) =>
          rows(
            connection,
            statusRowSchema,
            `SELECT version() AS version, current_user::text AS role, pg_is_in_recovery() AS replica,
                    (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls`,
          ),
        );
        return status;
      });
  }
}
// #endregion run
