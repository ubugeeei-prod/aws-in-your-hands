import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { LongJobsStack } from "../lib/long-jobs-stack.ts";

const app = new App();

// #region context
// `-c durable=true` adds the durable-function variant of the export. Without it the stack has no durable function.
const durable =
  v.parse(v.optional(v.picklist(["true", "false"]), "false"), app.node.tryGetContext("durable")) ===
  "true";
// #endregion context

new LongJobsStack(app, "AihLongJobs", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 16: a resumable notes export with Step Functions",
  durable,
});
