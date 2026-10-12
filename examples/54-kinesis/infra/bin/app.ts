import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { KinesisStack } from "../lib/kinesis-stack.ts";

// #region context
// Values given with `-c name=value`. They come from outside the code, so they are checked.
const contextSchema = v.object({
  alarmEmail: v.optional(v.pipe(v.string(), v.email())),
  // Chapter 19 prints its topic as AlarmTopicArn.
  alarmTopicArn: v.optional(
    v.pipe(v.string(), v.regex(/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/)),
  ),
});
// #endregion context

const app = new App();
const context = v.parse(contextSchema, {
  alarmEmail: app.node.tryGetContext("alarmEmail"),
  alarmTopicArn: app.node.tryGetContext("alarmTopicArn"),
});

new KinesisStack(app, "AihKinesis", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 54: a Kinesis data stream of note revisions and a Lambda consumer",
  ...context,
});
