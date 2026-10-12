import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { LimitsStack } from "../lib/limits-stack.ts";

const REGION = "ap-northeast-1";

// #region context
// Values given with `-c name=value`. They come from outside the code, so they are checked.
// A context value is text: "5" becomes 5, and "five" becomes NaN, which v.number() refuses.
const count = v.pipe(v.string(), v.transform(Number), v.number(), v.integer(), v.minValue(1));

const contextSchema = v.object({
  allowedOrigin: v.optional(
    // v.url() alone would accept "localhost:5173" (scheme "localhost").
    v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//, "Must be an http or https URL.")),
    "http://localhost:5173",
  ),
  reservedConcurrency: v.optional(v.pipe(count, v.maxValue(100))),
  monthlyBudgetUsd: v.optional(v.pipe(count, v.maxValue(10_000)), "5"),
  budgetEmail: v.optional(v.pipe(v.string(), v.email())),
  alarmTopicArn: v.optional(
    v.pipe(v.string(), v.regex(new RegExp(`^arn:aws:sns:${REGION}:\\d{12}:[A-Za-z0-9_-]+$`))),
  ),
});
// #endregion context

const app = new App();
const context = v.parse(contextSchema, {
  allowedOrigin: app.node.tryGetContext("allowedOrigin"),
  reservedConcurrency: app.node.tryGetContext("reservedConcurrency"),
  monthlyBudgetUsd: app.node.tryGetContext("monthlyBudgetUsd"),
  budgetEmail: app.node.tryGetContext("budgetEmail"),
  alarmTopicArn: app.node.tryGetContext("alarmTopicArn"),
});

new LimitsStack(app, "AihLimits", {
  env: { region: REGION },
  description: "AWS in Your Hands chapter 32: the notes API with its limits, tags and a budget",
  ...context,
});
