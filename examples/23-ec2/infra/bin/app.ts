import { App } from "aws-cdk-lib";
import { EC2_STACK, parseEc2Config, REGION } from "../../src/config.ts";
import { Ec2Stack } from "../lib/ec2-stack.ts";

const app = new App();

// #region context
// `-c placement=public`, `-c dataOnDestroy=snapshot`, `-c dataSnapshotId=snap-...`, `-c amiId=ami-...`.
const config = parseEc2Config({
  placement: app.node.tryGetContext("placement"),
  instanceType: app.node.tryGetContext("instanceType"),
  dataVolumeGiB: app.node.tryGetContext("dataVolumeGiB"),
  dataOnDestroy: app.node.tryGetContext("dataOnDestroy"),
  dataSnapshotId: app.node.tryGetContext("dataSnapshotId"),
  amiId: app.node.tryGetContext("amiId"),
  allowedOrigin: app.node.tryGetContext("allowedOrigin"),
});
// #endregion context

new Ec2Stack(app, EC2_STACK, {
  env: { region: REGION },
  description: "AWS in Your Hands chapter 23: one EC2 instance reached through Systems Manager, with a data volume",
  config,
});
