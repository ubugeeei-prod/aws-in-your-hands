import { App } from "aws-cdk-lib";

import { NITRO_STACK, parseNitroConfig, REGION } from "../../src/config.ts";
import { NitroStack } from "../lib/nitro-stack.ts";

const app = new App();

// #region context
// `-c measurement=<PCR0 from nitro-cli build-enclave>`, `-c instanceType=m6g.large`, `-c amiId=ami-...`.
const config = parseNitroConfig({
  instanceType: app.node.tryGetContext("instanceType"),
  measurement: app.node.tryGetContext("measurement"),
  amiId: app.node.tryGetContext("amiId"),
});
// #endregion context

new NitroStack(app, NITRO_STACK, {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 68: an enclave-enabled instance and a key only its enclave can use",
  config,
});
