// The file AgentCore Runtime starts, once infra/lib/bundle.ts has made it one app.js.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { createBedrockGateway } from "@aih/example-36-bedrock/src/bedrock.ts";

import { createAgentCoreMemoryStore } from "./agentcore-memory.ts";
import { composeAgent } from "./compose.ts";
import { parseEnv } from "./env.ts";
import { forwardedJwtAuthenticator } from "./identity.ts";

// #region server
const env = parseEnv(process.env);
const { NOTES_TABLE_NAME, MEMORY_ID, JWT_ISSUER, JWT_CLIENT_ID } = env;
if (
  env.AI_BACKEND !== "bedrock" ||
  [NOTES_TABLE_NAME, MEMORY_ID, JWT_ISSUER, JWT_CLIENT_ID].includes("")
) {
  throw new Error(
    "The deployed agent needs AI_BACKEND=bedrock, NOTES_TABLE_NAME, MEMORY_ID, JWT_ISSUER and JWT_CLIENT_ID.",
  );
}
const documents = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AGENT_REGION }));

const agent = composeAgent(env, {
  gateway: createBedrockGateway(env.AGENT_REGION),
  // The runtime's JWT authorizer has verified the token. This reads who it names.
  authenticate: forwardedJwtAuthenticator(
    { issuer: JWT_ISSUER, clientId: JWT_CLIENT_ID },
    Date.now,
  ),
  notes: new DynamoDbNoteRepository(documents, NOTES_TABLE_NAME),
  store: createAgentCoreMemoryStore(env.AGENT_REGION, MEMORY_ID, Date.now),
});

// 0.0.0.0:8080 is the address the HTTP contract names.
const server = nodeServer(agent).listen(env.PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", message: "listening", port: env.PORT }));
});
process.on("SIGTERM", () => server.close());
// #endregion server
