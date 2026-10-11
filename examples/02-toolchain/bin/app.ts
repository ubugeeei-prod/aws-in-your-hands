import { App } from "aws-cdk-lib";
import { parseHelloConfig } from "../lib/config.ts";
import { HelloStack } from "../lib/hello-stack.ts";

const app = new App();

// #region app
const config = parseHelloConfig({
  stage: app.node.tryGetContext("stage"),
  noncurrentVersionDays: app.node.tryGetContext("noncurrentVersionDays"),
});

new HelloStack(app, "AihHello", {
  // Fixed region, unresolved account: synth needs no credentials and makes no
  // AWS call. The account is whichever one the credentials at deploy time belong to.
  env: { region: "ap-northeast-1" },
  config,
});
// #endregion app
