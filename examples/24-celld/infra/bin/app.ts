import { App } from "aws-cdk-lib";
import { CELLD_STACK, parseFleetConfig, REGION } from "../../src/config.ts";
import { CelldStack } from "../lib/celld-stack.ts";

const app = new App();

// #region context
// `-c nodes=3`, `-c stateOnDestroy=delete`, `-c dataSnapshots=a:snap-...,b:snap-...`, `-c amiId=ami-...`.
// Without `-c nodes=...` the stack has no instance at all.
const config = parseFleetConfig({
  nodes: app.node.tryGetContext("nodes"),
  instanceType: app.node.tryGetContext("instanceType"),
  dataVolumeGiB: app.node.tryGetContext("dataVolumeGiB"),
  stateOnDestroy: app.node.tryGetContext("stateOnDestroy"),
  dataSnapshots: app.node.tryGetContext("dataSnapshots"),
  amiId: app.node.tryGetContext("amiId"),
});
// #endregion context

new CelldStack(app, CELLD_STACK, {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 24: a small celld fleet in private subnets, with a retained bucket and volumes",
  config,
});
