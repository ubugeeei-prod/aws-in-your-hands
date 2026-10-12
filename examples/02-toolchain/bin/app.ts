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
  // Region only, no account: synth needs no credentials and calls nothing.
  // The account comes from the credentials used at deploy time.
  env: { region: "ap-northeast-1" },
  config,
});
// #endregion app
