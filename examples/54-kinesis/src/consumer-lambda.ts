import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";

import { createBatchHandler } from "./consumer.ts";
import { DynamoDbHistoryStore } from "./dynamodb-history.ts";
import { parseConsumerEnv } from "./env.ts";

// #region lambda
const env = parseConsumerEnv(process.env);

// Invoked by the event source mapping with records of one shard, oldest first.
export const handler = createBatchHandler({
  store: new DynamoDbHistoryStore(
    DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env.HISTORY_TABLE,
  ),
  log: createLogger(env.LOG_LEVEL),
});
// #endregion lambda
