import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { ProgressiveStack } from "../lib/progressive-stack.ts";

// #region app
const app = new App();

// `-c fault=50` deploys a build that fails half its requests, to watch a rollback happen.
const fault = v.parse(
  v.pipe(
    v.string(),
    v.regex(/^\d+$/, "fault must be a whole number from 0 to 100"),
    v.transform(Number),
    v.maxValue(100, "fault must be a whole number from 0 to 100"),
  ),
  String(app.node.tryGetContext("fault") ?? "0"),
);

new ProgressiveStack(app, "AihProgressive", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 31: weighted alias, alarms, and AppConfig feature flags",
  allowedOrigin:
    (app.node.tryGetContext("allowedOrigin") as string | undefined) ?? "http://localhost:5173",
  faultPercent: fault,
});
// #endregion app
