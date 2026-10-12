import { App } from "aws-cdk-lib";

import { ModelingStack } from "../lib/modeling-stack.ts";

const app = new App();

new ModelingStack(app, "AihModeling", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 30: one table, an index, a stream and its consumer",
  // `-c insights=on` adds Contributor Insights rules, which are billed by the month.
  insights: app.node.tryGetContext("insights") === "on",
});
