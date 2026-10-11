import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { CfnChannel, CfnStreamKey } from "aws-cdk-lib/aws-ivs";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
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
    const channel = new CfnChannel(this, "Channel", {
      name: channelSettings.name,
      type: channelSettings.type,
      latencyMode: channelSettings.latencyMode,
      // Playback needs no token: anyone with the playback URL can watch.
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
      const streamKey = new CfnStreamKey(this, "StreamKey", { channelArn: channel.attrArn });
      streamKey.applyRemovalPolicy(RemovalPolicy.DESTROY);
      // The ARN only. `attrValue` is the secret and never becomes an output.
      new CfnOutput(this, "StreamKeyArn", { value: streamKey.attrArn });
    }
    // #endregion stream-key

    // #region events
    const logGroup = new LogGroup(this, "EventLogs", {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new Role(this, "EventHandlerRole", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
    logGroup.grantWrite(role);

    const onEvent = new NodejsFunction(this, "EventHandler", {
      entry: fileURLToPath(new URL("../../src/handler.ts", import.meta.url)),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(5),
      role,
      logGroup,
      bundling: { format: OutputFormat.ESM, target: "node24", minify: false, sourceMap: false },
    });

    // Only this channel. Account-wide limit breaches carry no resource and do not match.
    new Rule(this, "ChannelEvents", {
      eventPattern: {
        source: ["aws.ivs"],
        detailType: ["IVS Stream State Change", "IVS Stream Health Change", "IVS Limit Breach"],
        resources: [channel.attrArn],
      },
      targets: [new LambdaFunction(onEvent)],
    });
    // #endregion events

    new CfnOutput(this, "ChannelArn", { value: channel.attrArn });
    new CfnOutput(this, "IngestEndpoint", { value: channel.attrIngestEndpoint });
    new CfnOutput(this, "PlaybackUrl", { value: channel.attrPlaybackUrl });
    new CfnOutput(this, "EventLogGroupName", { value: logGroup.logGroupName });
  }
}
