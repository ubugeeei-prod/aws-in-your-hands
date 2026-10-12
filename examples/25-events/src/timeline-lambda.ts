import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";

import { busEventSchema } from "./contract.ts";
import { DynamoDbTimelineStore } from "./dynamodb-projections.ts";
import { parseConsumerEnv } from "./env.ts";
import { createTimelineConsumer } from "./timeline.ts";

// #region handler
const env = parseConsumerEnv(process.env);
const log = createLogger(env.LOG_LEVEL);
const consume = createTimelineConsumer(
  new DynamoDbTimelineStore(
    DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env.PROJECTIONS_TABLE,
  ),
);

// Invoked by the rule, asynchronously, with one event. A throw here is
// retried by Lambda, not by EventBridge: the delivery itself succeeded.
export const handler = async (input: unknown) => {
  const event = v.parse(busEventSchema, input);
  const status = await consume(event.detail);
  log({
    level: "info",
    message: "timeline",
    status,
    type: event["detail-type"],
    busEventId: event.id,
    replay: event["replay-name"] ?? null,
  });
};
// #endregion handler
