import { App } from "aws-cdk-lib";

import { DISTSQL_STACK, parseClusterConfig, REGION } from "../../src/config.ts";
import { DistSqlStack } from "../lib/distsql-stack.ts";

const app = new App();

// #region context
// `-c nodes=3`, `-c instanceType=m7g.large`, `-c dataVolumeGiB=250`, `-c stateOnDestroy=delete`, `-c amiId=ami-...`.
// Without `-c nodes=3` the stack has no instance at all.
const config = parseClusterConfig({
  nodes: app.node.tryGetContext("nodes"),
  instanceType: app.node.tryGetContext("instanceType"),
  dataVolumeGiB: app.node.tryGetContext("dataVolumeGiB"),
  stateOnDestroy: app.node.tryGetContext("stateOnDestroy"),
  amiId: app.node.tryGetContext("amiId"),
});
// #endregion context

new DistSqlStack(app, DISTSQL_STACK, {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 66: three database nodes in three zones, with retained volumes and a bucket",
  config,
});
