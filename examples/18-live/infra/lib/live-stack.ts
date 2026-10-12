import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ivs from "aws-cdk-lib/aws-ivs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import { channelSettings } from "../../src/channel.ts";

export type LiveStackProps = StackProps & {
  /** false removes the stream key, so nobody can broadcast. Deploying true again makes a new one. */
  streamKey: boolean;
};

export class LiveStack extends Stack {
  constructor(scope: Construct, id: string, props: LiveStackProps) {
    super(scope, id, props);

    // #region channel
    const channel = new ivs.CfnChannel(this, "Channel", {
      name: channelSettings.name,
      type: channelSettings.type,
      latencyMode: channelSettings.latencyMode,
      // Playback needs no token: anyone with the playback URL can watch, and each viewer-hour is billed.
      authorized: false,
      // RTMPS only. Plain RTMP would send the stream key unencrypted.
      insecureIngest: false,
    });
    channel.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // #endregion channel

    // #region stream-key
    // The API creates a key with every channel. CloudFormation does not, and a
    // channel holds one key at most, so this resource is the only way in.
    if (props.streamKey) {
      const streamKey = new ivs.CfnStreamKey(this, "StreamKey", { channelArn: channel.attrArn });
      streamKey.applyRemovalPolicy(RemovalPolicy.DESTROY);
      // The ARN only. `attrValue` is the secret and never becomes an output.
      new CfnOutput(this, "StreamKeyArn", { value: streamKey.attrArn });
    }
    // #endregion stream-key

    // #region events
    const logGroup = new logs.LogGroup(this, "EventLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, "EventHandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);

    const onEvent = new nodejs.NodejsFunction(this, "EventHandler", {
      entry: fileURLToPath(new URL("../../src/handler.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(5),
      role,
      logGroup,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
      },
    });

    // Only this channel. Account-wide limit breaches carry no resource and do not match.
    new events.Rule(this, "ChannelEvents", {
      eventPattern: {
        source: ["aws.ivs"],
        detailType: ["IVS Stream State Change", "IVS Stream Health Change", "IVS Limit Breach"],
        resources: [channel.attrArn],
      },
      targets: [new targets.LambdaFunction(onEvent)],
    });
    // #endregion events

    new CfnOutput(this, "ChannelArn", { value: channel.attrArn });
    new CfnOutput(this, "IngestEndpoint", { value: channel.attrIngestEndpoint });
    new CfnOutput(this, "PlaybackUrl", { value: channel.attrPlaybackUrl });
    new CfnOutput(this, "EventLogGroupName", { value: logGroup.logGroupName });
  }
}
