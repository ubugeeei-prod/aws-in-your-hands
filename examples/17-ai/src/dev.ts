import { setTimeout as sleep } from "node:timers/promises";

import * as v from "valibot";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { createBedrockGateway } from "./bedrock.ts";
import { composeApp } from "./compose.ts";
import { parseEnv } from "./env.ts";
import { createFixtureGateway } from "./fixture-gateway.ts";
import { fixtureNames, fixtures } from "./fixtures.ts";
import type { ModelGateway } from "./summarize.ts";

// #region dev
const env = parseEnv(process.env);
const port = Number(process.env["PORT"] ?? 8788);

let gateway: ModelGateway;
if (env.AI_BACKEND === "bedrock") {
  // This server runs here. The model does not: every summary is a billed call to Bedrock.
  gateway = createBedrockGateway(env.AWS_REGION);
  console.log(`inference: REMOTE and BILLED. Bedrock ${env.BEDROCK_MODEL_ID} in ${env.AWS_REGION}`);
} else {
  const name = v.parse(v.optional(v.picklist(fixtureNames), "complete"), process.env["AI_FIXTURE"]);
  // 150 ms between events, so the stream is visible in curl.
  gateway = createFixtureGateway(fixtures[name], (abort) =>
    sleep(150, undefined, { signal: abort }).then(
      () => undefined,
      () => undefined,
    ),
  );
  console.log(
    `inference: none. Replaying fixtures/converse-stream/${name}.json. No AWS call, no charge`,
  );
}

// Loopback only: with AI_BACKEND=bedrock, anyone who can reach this port spends your money.
nodeServer(composeApp(env, gateway)).listen(port, "127.0.0.1", () => {
  console.log(`summary API on http://localhost:${port}`);
});
// #endregion dev
