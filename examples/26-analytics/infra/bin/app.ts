import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { FORMATS } from "../../src/partition.ts";
import { AnalyticsStack } from "../lib/analytics-stack.ts";

// #region context
// Values given with `-c name=value`. They come from outside the code, so they are checked.
const contextSchema = v.object({
  allowedOrigin: v.optional(
    // v.url() alone would accept "localhost:5173" (scheme "localhost").
    v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//, "Must be an http or https URL.")),
    "http://localhost:5173",
  ),
  // json: gzip-compressed lines, readable with zcat. parquet: converted by Firehose, billed per GB.
  format: v.optional(v.picklist(FORMATS), "json"),
});
// #endregion context

const app = new App();
const context = v.parse(contextSchema, {
  allowedOrigin: app.node.tryGetContext("allowedOrigin"),
  format: app.node.tryGetContext("format"),
});

new AnalyticsStack(app, "AihAnalytics", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 26: request records through Firehose to S3, queried with Athena",
  ...context,
});
