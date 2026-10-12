import { SNSClient } from "@aws-sdk/client-sns";

import { handleExecutionEvent } from "./alert.ts";
import { readEnv } from "./env.ts";
import { SnsNotifier } from "./notifier.ts";

const env = readEnv(process.env);
const notifier = new SnsNotifier(new SNSClient({}), env.ALERT_TOPIC_ARN);

export async function handler(event: unknown): Promise<void> {
  await handleExecutionEvent(event, {
    taskArn: env.TASK_ARN,
    notifier,
    log: (line) => console.log(JSON.stringify(line)),
  });
}
