import { App } from "aws-cdk-lib";

import { HOST_STACK, parseHostConfig, REGION } from "../../src/host-config.ts";
import { FirecrackerHostStack } from "../lib/firecracker-host-stack.ts";

const app = new App();

// #region context
// `-c run=true` adds the instance. Without it nothing in the stack is billed.
const config = parseHostConfig({
  run: app.node.tryGetContext("run"),
  instanceType: app.node.tryGetContext("instanceType"),
  rootVolumeGiB: app.node.tryGetContext("rootVolumeGiB"),
});
// #endregion context

new FirecrackerHostStack(app, HOST_STACK, {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 67: a place to try Firecracker, an instance with nested virtualization",
  config,
});
