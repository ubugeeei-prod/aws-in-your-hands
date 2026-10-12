import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";

import { DynamoDbLedger } from "./dynamodb-ledger.ts";
import { parseEnv } from "./env.ts";
import { MARKER_DAYS } from "./settings.ts";
import { createParker } from "./sqs-sender.ts";
import { createFifoBatchHandler } from "./worker.ts";

// #region handler
const env = parseEnv(process.env);
const documents = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Invoked by the event source mapping. What it returns tells Lambda which
// messages to leave in the queue.
export const handler = createFifoBatchHandler({
  ledger: new DynamoDbLedger(documents, env.TABLE_NAME, MARKER_DAYS, () => new Date()),
  park: createParker(new SQSClient({}), env.DEAD_LETTER_QUEUE_URL),
  log: createLogger(env.LOG_LEVEL),
});
// #endregion handler
