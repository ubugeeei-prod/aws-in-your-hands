// #region names
/** Runs migrations and owns what they create. Signs in with an IAM token. */
export const MIGRATOR_ROLE = "notes_migrator";
/** Reads and writes rows, and nothing else. Signs in with an IAM token. */
export const API_ROLE = "notes_api";
// #endregion names

// GRANT and CREATE ROLE take no `$1`, so these names go into the SQL text.
// Nothing but a plain lower-case identifier is let through.
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`${JSON.stringify(name)} is not a plain PostgreSQL identifier`);
  }
  return name;
}

// #region bootstrap
/**
 * Run once as the master user. `create` statements fail with SQLSTATE 42710
 * when the role is already there; the caller lets that one pass.
 */
export function bootstrapStatements(database: string): { create: string[]; grant: string[] } {
  const db = identifier(database);
  return {
    create: [`CREATE ROLE ${MIGRATOR_ROLE} LOGIN`, `CREATE ROLE ${API_ROLE} LOGIN`],
    grant: [
      // rds_iam: this role signs in with an IAM token, and no longer with a password.
      `GRANT rds_iam TO ${MIGRATOR_ROLE}`,
      `GRANT rds_iam TO ${API_ROLE}`,
      // Enough to create the `app` schema and the migrations table. Not CREATEROLE, not CREATEDB.
      `GRANT CREATE ON DATABASE ${db} TO ${MIGRATOR_ROLE}`,
      `GRANT CREATE ON SCHEMA public TO ${MIGRATOR_ROLE}`,
    ],
  };
}
// #endregion bootstrap

// #region grants
/** Run by the migrator after every migration. Each statement may be repeated. */
export function apiGrantStatements(schema: string): string[] {
  const s = identifier(schema);
  const rows = "SELECT, INSERT, UPDATE, DELETE";
  return [
    `GRANT USAGE ON SCHEMA ${s} TO ${API_ROLE}`,
    `GRANT ${rows} ON ALL TABLES IN SCHEMA ${s} TO ${API_ROLE}`,
    // Tables this role creates later are covered without running the line above again.
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT ${rows} ON TABLES TO ${API_ROLE}`,
  ];
}
// #endregion grants
