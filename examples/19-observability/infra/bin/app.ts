import { App } from "aws-cdk-lib";
import { z } from "zod";

import { ObservabilityStack } from "../lib/observability-stack.ts";

const REGION = "ap-northeast-1";

// #region context
// Values given with `-c name=value`. They come from outside the code, so they are checked.
const contextSchema = z.object({
  allowedOrigin: z.url({ protocol: /^https?$/ }).default("http://localhost:5173"),
  alarmEmail: z.email().optional(),
  // Copied from the ADOT documentation. A layer from another Region cannot be attached.
  otelLayerArn: z
    .string()
    .regex(new RegExp(`^arn:aws:lambda:${REGION}:\\d{12}:layer:[A-Za-z0-9_-]+:\\d+$`))
    .optional(),
});
// #endregion context

const app = new App();
const context = contextSchema.parse({
  allowedOrigin: app.node.tryGetContext("allowedOrigin"),
  alarmEmail: app.node.tryGetContext("alarmEmail"),
  otelLayerArn: app.node.tryGetContext("otelLayerArn"),
});

new ObservabilityStack(app, "AihObservability", {
  env: { region: REGION },
  description: "AWS in Your Hands chapter 19: alarms, a dashboard and tracing for the notes API",
  ...context,
});
