import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";

import { createBedrockGateway } from "./bedrock.ts";
import { composeApp } from "./compose.ts";
import { DynamoDbUsageLedger } from "./dynamodb-ledger.ts";
import { parseEnv } from "./env.ts";
import { streamWithEvent } from "./function-url.ts";
import { identityFromFunctionUrl } from "./identity.ts";

// #region handler
const env = parseEnv(process.env);
if (env.AI_BACKEND !== "bedrock" || env.NOTES_TABLE_NAME === "" || env.USAGE_TABLE_NAME === "") {
  throw new Error(
    "The deployed function needs AI_BACKEND=bedrock, NOTES_TABLE_NAME and USAGE_TABLE_NAME.",
  );
}
const documents = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION }));

// `awslambda` is not imported: the Node.js runtime on Lambda defines it before this file runs.
export const handler = streamWithEvent(
  composeApp(env, {
    gateway: createBedrockGateway(env.AWS_REGION),
    authenticate: ({ event }) => Promise.resolve(identityFromFunctionUrl(event)),
    notes: new DynamoDbNoteRepository(documents, env.NOTES_TABLE_NAME),
    ledger: new DynamoDbUsageLedger(documents, env.USAGE_TABLE_NAME),
  }),
  awslambda,
);
// #endregion handler
