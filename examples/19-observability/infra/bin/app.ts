import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { ObservabilityStack } from "../lib/observability-stack.ts";

const REGION = "ap-northeast-1";

// #region context
// Values given with `-c name=value`. They come from outside the code, so they are checked.
const contextSchema = v.object({
  allowedOrigin: v.optional(
    // v.url() alone would accept "localhost:5173" (scheme "localhost").
    v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//, "Must be an http or https URL.")),
    "http://localhost:5173",
  ),
  alarmEmail: v.optional(v.pipe(v.string(), v.email())),
  // Copied from the ADOT documentation. A layer from another Region cannot be attached.
  otelLayerArn: v.optional(
    v.pipe(
      v.string(),
      v.regex(new RegExp(`^arn:aws:lambda:${REGION}:\\d{12}:layer:[A-Za-z0-9_-]+:\\d+$`)),
    ),
  ),
});
// #endregion context

const app = new App();
const context = v.parse(contextSchema, {
  allowedOrigin: app.node.tryGetContext("allowedOrigin"),
  alarmEmail: app.node.tryGetContext("alarmEmail"),
  otelLayerArn: app.node.tryGetContext("otelLayerArn"),
});

new ObservabilityStack(app, "AihObservability", {
  env: { region: REGION },
  description: "AWS in Your Hands chapter 19: alarms, a dashboard and tracing for the notes API",
  ...context,
});
