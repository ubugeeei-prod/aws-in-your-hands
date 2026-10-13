import { App } from "aws-cdk-lib";

import { STACK } from "../../src/names.ts";
import { parseRelease } from "../../src/release.ts";
import { WebFunctionsStack } from "../lib/web-functions-stack.ts";

// #region app
// No AWS::CDK::Metadata resource, as in chapter 20: this stack goes through CloudFormation too.
const app = new App({ analyticsReporting: false });

new WebFunctionsStack(app, STACK, {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 69: the notes API as a Lambda Web Function",
  allowedOrigin:
    (app.node.tryGetContext("allowedOrigin") as string | undefined) ?? "http://localhost:5173",
  // `-c stable=<S3 version ID>`, and for a canary `-c canary=<S3 version ID> -c canaryWeight=10`.
  release: parseRelease((key) => app.node.tryGetContext(key)),
});
// #endregion app
