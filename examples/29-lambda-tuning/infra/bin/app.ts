import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { TuningStack } from "../lib/tuning-stack.ts";

// #region context
// Values given with `-c name=value` are text. "512" becomes 512; "big" becomes NaN, which v.number() refuses.
const count = (min: number, max: number) =>
  v.pipe(
    v.string(),
    v.transform(Number),
    v.number(),
    v.integer(),
    v.minValue(min),
    v.maxValue(max),
  );

const contextSchema = v.object({
  allowedOrigin: v.optional(
    // v.url() alone would accept "localhost:5173" (scheme "localhost").
    v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//, "Must be an http or https URL.")),
    "http://localhost:5173",
  ),
  // Lambda accepts 128 to 10,240 MB in steps of 1 MB.
  memorySize: v.optional(count(128, 10_240), "256"),
  // 0 would stop the function altogether, which is a different switch.
  reservedConcurrency: v.optional(count(1, 900)),
  provisionedConcurrency: v.optional(count(1, 900)),
});
// #endregion context

const app = new App();
const context = v.parse(contextSchema, {
  allowedOrigin: app.node.tryGetContext("allowedOrigin"),
  memorySize: app.node.tryGetContext("memorySize"),
  reservedConcurrency: app.node.tryGetContext("reservedConcurrency"),
  provisionedConcurrency: app.node.tryGetContext("provisionedConcurrency"),
});

// Lambda refuses more provisioned than reserved concurrency. Better here than halfway through a deploy.
if (
  context.reservedConcurrency !== undefined &&
  context.provisionedConcurrency !== undefined &&
  context.provisionedConcurrency > context.reservedConcurrency
) {
  throw new Error("provisionedConcurrency cannot exceed reservedConcurrency.");
}

new TuningStack(app, "AihLambdaTuning", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 29: the notes API with memory and concurrency as options",
  ...context,
});
