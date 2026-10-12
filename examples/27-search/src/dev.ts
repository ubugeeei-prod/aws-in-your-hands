import { setTimeout as sleep } from "node:timers/promises";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
import { createLogger } from "@aih/example-04-http-api/src/log.ts";

import { awsParts } from "./aws-parts.ts";
import { composeApp } from "./compose.ts";
import { parseEnv } from "./env.ts";
import { localParts } from "./local.ts";

// #region dev
const env = parseEnv(process.env);
const port = Number(process.env["PORT"] ?? 8827);

let parts;
if (env.SEARCH_BACKEND === "aws") {
  // This server runs here. The table, the index and both models do not, and they bill.
  parts = awsParts(env, createLogger(env.LOG_LEVEL));
  console.log(`search: REMOTE and BILLED. Table ${env.TABLE_NAME}, index ${env.VECTOR_INDEX_ARN}`);
} else {
  // 150 ms between events, so the stream is visible in curl.
  parts = await localParts((abort) =>
    sleep(150, undefined, { signal: abort }).then(
      () => undefined,
      () => undefined,
    ),
  );
  console.log("search: in memory. Seed notes for alice and bob, a hashing embedder that knows");
  console.log("        no meaning, and one canned answer. No AWS call, no charge");
}

// Loopback only: the owner header is believed as it is.
nodeServer(composeApp(env, parts)).listen(port, "127.0.0.1", () => {
  console.log(`search API on http://localhost:${port}`);
});
// #endregion dev
