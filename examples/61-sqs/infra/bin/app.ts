import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { SqsStack } from "../lib/sqs-stack.ts";

// #region context
// Values given with `-c name=value`. They come from outside the code, so they are checked.
const contextSchema = v.object({
  // Chapter 19 prints its topic as AlarmTopicArn.
  alarmTopicArn: v.optional(
    v.pipe(v.string(), v.regex(/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/)),
  ),
  senderAccountId: v.optional(v.pipe(v.string(), v.regex(/^\d{12}$/))),
});
// #endregion context

const app = new App();
const context = v.parse(contextSchema, {
  alarmTopicArn: app.node.tryGetContext("alarmTopicArn"),
  senderAccountId: app.node.tryGetContext("senderAccountId"),
});

new SqsStack(app, "AihSqs", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 61: a FIFO queue with a dead-letter queue, a worker with bounded concurrency, and alarms",
  ...context,
});
