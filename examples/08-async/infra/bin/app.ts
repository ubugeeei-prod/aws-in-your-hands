import { App } from "aws-cdk-lib";
import { AsyncStack } from "../lib/async-stack.ts";

const app = new App();

new AsyncStack(app, "AihAsync", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 08: uploads inspected off the request with SQS, and hourly housekeeping",
});
