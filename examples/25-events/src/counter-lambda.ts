import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";

import { createCounterBatchHandler } from "./counter-queue.ts";
import { createCounter } from "./counter.ts";
import { DynamoDbCounterStore } from "./dynamodb-projections.ts";
import { parseConsumerEnv } from "./env.ts";
import { COUNTED_MARKER_DAYS } from "./routes.ts";

// #region handler
const env = parseConsumerEnv(process.env);

export const handler = createCounterBatchHandler({
  count: createCounter(
    new DynamoDbCounterStore(
      DynamoDBDocumentClient.from(new DynamoDBClient({})),
      env.PROJECTIONS_TABLE,
      COUNTED_MARKER_DAYS,
      () => new Date(),
    ),
  ),
  log: createLogger(env.LOG_LEVEL),
});
// #endregion handler
