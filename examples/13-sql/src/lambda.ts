import { handle } from "hono/aws-lambda";

import { composeApp } from "./compose.ts";
import { openDsql } from "./dsql.ts";
import { parseEnv, regionOfEndpoint } from "./env.ts";

// #region handler
const env = parseEnv(process.env);
if (env.NOTES_DB !== "dsql") {
  // The local stand-in is not bundled into the function.
  throw new Error("On Lambda, NOTES_DB must be dsql.");
}

// Once per execution environment. No connection is opened yet: the first
// query opens one, and later invocations in this environment reuse it.
const db = openDsql({
  endpoint: env.DSQL_ENDPOINT,
  region: regionOfEndpoint(env.DSQL_ENDPOINT),
  user: env.DSQL_USER,
  onPoolError: (error) =>
    console.error(
      JSON.stringify({ level: "warn", message: "idle connection lost", error: error.message }),
    ),
});

export const handler = handle(composeApp(env, db));
// #endregion handler
