import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { AthenaStack } from "../lib/athena-stack.ts";

// #region context
// `-c lakeBucketName=<name>`: chapter 26's bucket. It comes from outside the code, so it is checked.
const contextSchema = v.object({
  lakeBucketName: v.optional(v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/))),
});
// #endregion context

const app = new App();
const context = v.parse(contextSchema, {
  lakeBucketName: app.node.tryGetContext("lakeBucketName"),
});

new AthenaStack(app, "AihAthena", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 49: an Athena workgroup with a scan limit, its output bucket, saved queries and an analyst role",
  ...(context.lakeBucketName !== undefined && { lakeBucketName: context.lakeBucketName }),
});
