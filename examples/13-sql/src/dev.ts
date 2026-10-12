import { fileURLToPath } from "node:url";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { composeApp } from "./compose.ts";
import type { Db } from "./db.ts";
import { openDsql } from "./dsql.ts";
import { parseEnv, regionOfEndpoint } from "./env.ts";
import { loadMigrations, pendingMigrations } from "./migrate.ts";
import { openPglite } from "./pglite.ts";

// #region dev
const env = parseEnv(process.env);
let db: Db;
if (env.NOTES_DB === "pglite") {
  db = await openPglite(env.PGLITE_DATA_DIR);
  // Like `wrangler dev`, this server does not migrate for you.
  const migrations = loadMigrations(fileURLToPath(new URL("../migrations", import.meta.url)));
  const pending = await db.withConnection((connection) =>
    pendingMigrations(connection, migrations),
  );
  if (pending.length > 0) {
    await db.close();
    console.error(
      `Not applied yet: ${pending.join(", ")}\nRun \`vp run sql:db:migrate:local\`, then start again.`,
    );
    process.exit(1);
  }
} else {
  // A deployed cluster, with your own AWS credentials. Billed.
  db = openDsql({
    endpoint: env.DSQL_ENDPOINT,
    region: regionOfEndpoint(env.DSQL_ENDPOINT),
    user: env.DSQL_USER,
    onPoolError: (error) => console.error(`idle connection lost: ${error.message}`),
  });
}

const port = Number(process.env["PORT"] ?? 8787);
nodeServer(composeApp(env, db)).listen(port, () => {
  console.log(`notes API on http://localhost:${port} (db: ${env.NOTES_DB})`);
});
// #endregion dev
