import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { DELIVERIES } from "../../src/watch.ts";
import { HealthStack } from "../lib/health-stack.ts";

// #region context
// Values given with `-c name=value`. They come from outside the code, so they are checked.
const contextSchema = v.object({
  alarmEmail: v.optional(v.pipe(v.string(), v.email())),
  // Chapter 19 prints its topic as AlarmTopicArn. Any Region: the function's client follows the ARN.
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

// #region stacks
// A rule sees only the events delivered to its own Region, so each Region gets the whole stack.
for (const delivery of DELIVERIES) {
  new HealthStack(app, delivery.stack, {
    env: { region: delivery.region },
    description: `AWS in Your Hands chapter 44: AWS Health events delivered to ${delivery.region}, sent on as notices`,
    delivery,
    ...context,
  });
}
// #endregion stacks
