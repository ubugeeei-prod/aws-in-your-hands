import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import * as v from "valibot";

import { createNotifier } from "./notify.ts";

const env = v.parse(
  v.object({ TOPIC_ARN: v.pipe(v.string(), v.startsWith("arn:aws:sns:")) }),
  process.env,
);
const sns = new SNSClient({});

// #region handler
export const handler = createNotifier({
  publish: async (subject, body) => {
    await sns.send(
      new PublishCommand({ TopicArn: env.TOPIC_ARN, Subject: subject, Message: body }),
    );
  },
  log: (entry) => console.log(JSON.stringify(entry)),
});
// #endregion handler
