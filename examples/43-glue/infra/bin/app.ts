import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { GlueStack } from "../lib/glue-stack.ts";

// #region context
// Given with `-c schedule=on`. It comes from outside the code, so it is checked.
const contextSchema = v.object({
  // on: the job runs every day at 01:00 UTC, billed for each run.
  schedule: v.optional(v.picklist(["on", "off"]), "off"),
});
// #endregion context

const app = new App();
const context = v.parse(contextSchema, { schedule: app.node.tryGetContext("schedule") });

new GlueStack(app, "AihGlue", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 43: a Glue job that curates request records",
  schedule: context.schedule === "on",
});
