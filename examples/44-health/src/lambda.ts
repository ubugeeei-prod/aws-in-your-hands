import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { dynamodbLedger } from "./dynamodb-ledger.ts";
import { handle } from "./notify.ts";
import { SERVICES } from "./watch.ts";

const env = v.parse(
  v.object({
    TABLE_NAME: v.pipe(v.string(), v.minLength(1)),
    TOPIC_ARN: v.pipe(v.string(), v.regex(/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/)),
  }),
  process.env,
);

// #region handler
// Made once per execution environment, outside the handler.
const ledger = dynamodbLedger(DynamoDBDocumentClient.from(new DynamoDBClient({})), env.TABLE_NAME);
// The topic may live in another Region than the function: the client follows the ARN.
const sns = new SNSClient({ region: env.TOPIC_ARN.split(":")[3] });

// EventBridge invokes asynchronously: a thrown error makes Lambda try twice more,
// then put the event in the function's dead-letter queue.
export const handler = async (event: unknown): Promise<void> => {
  await handle(event, {
    ledger,
    services: SERVICES,
    now: () => Date.now(),
    log: (line) => console.log(JSON.stringify(line)),
    publish: async ({ subject, body }) => {
      await sns.send(
        new PublishCommand({ TopicArn: env.TOPIC_ARN, Subject: subject, Message: body }),
      );
    },
  });
};
// #endregion handler
