import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";
import { composeApp, createRepository } from "@aih/example-05-dynamodb/src/compose.ts";
import { parseEnv } from "@aih/example-05-dynamodb/src/env.ts";

import { parseRegionalEnv } from "./env.ts";
import { createRegionalApp } from "./regional-app.ts";

// #region handler
const regional = parseRegionalEnv(process.env);
// The SDK client inside talks to DynamoDB in the Region the function runs in.
// The same code, deployed twice, therefore reads and writes two different copies.
const repository = createRepository(parseEnv(process.env));

const app = createRegionalApp({
  app: composeApp(process.env),
  region: regional.REGION,
  writes: regional.WRITES,
  // A note that does not exist: one small read that proves the table, the
  // network path, and the role all work from here.
  probe: async () => {
    await repository.get("health", "probe");
  },
  probeTimeoutMs: 1500,
  failHealth: regional.HEALTH === "fail",
});

export const handler = handleApiGateway(app);
// #endregion handler
