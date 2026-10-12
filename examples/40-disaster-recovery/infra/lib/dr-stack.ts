import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as drs from "aws-cdk-lib/aws-drs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";

import type { DrConfig } from "../../src/config.ts";
import { DETAIL_TYPES } from "../../src/events.ts";
import { ownEndpoints } from "../../src/network.ts";
import { launchTemplate, replicationTemplate } from "../../src/templates.ts";

export type DrStackProps = StackProps & { config: DrConfig };

/** The port the agent streams blocks to. The only one this stack opens anywhere. */
export const REPLICATION_PORT = 1500;

export class DrStack extends Stack {
  constructor(scope: Construct, id: string, props: DrStackProps) {
    super(scope, id, props);
    const { config } = props;
    const named = (name: string) => [{ key: "Name", value: `${id}/${name}` }];

    // #region staging
    // The chapter 11 VPC. The source is in its first zone, so everything here goes to the second.
    const vpc = importNetwork(this, "Network");
    const staging = config.placement === "public" ? vpc.publicSubnets[1] : vpc.isolatedSubnets[1];
    if (staging === undefined) {
      throw new Error(`the network has no second ${config.placement} subnet`);
    }

    const services = ownEndpoints(config.placement);
    if (services.length > 0) {
      const endpointGroup = new ec2.CfnSecurityGroup(this, "EndpointSecurityGroup", {
        groupDescription: "Chapter 40 endpoints: HTTPS from inside the VPC",
        vpcId: vpc.vpcId,
        securityGroupIngress: [
          {
            ipProtocol: "tcp",
            fromPort: 443,
            toPort: 443,
            cidrIp: vpc.vpcCidrBlock,
            description: "HTTPS from the VPC",
          },
        ],
        tags: named("endpoints"),
      });
      for (const service of services) {
        new ec2.CfnVPCEndpoint(this, `${service.toUpperCase()}InterfaceEndpoint`, {
          vpcEndpointType: "Interface",
          serviceName: `com.amazonaws.${this.region}.${service}`,
          vpcId: vpc.vpcId,
          // One zone, and the one that survives: the agent in the other zone reaches it by its DNS name.
          subnetIds: [staging.subnetId],
          securityGroupIds: [endpointGroup.attrGroupId],
          privateDnsEnabled: true,
        });
      }
    }
    // #endregion staging

    // #region agent
    const sourceServers = this.formatArn({
      service: "drs",
      resource: "source-server",
      resourceName: "*",
    });
    // AWSElasticDisasterRecoveryEc2InstancePolicy (v5) without what one account and one VPC do
    // not use: the cross-account role and source networks. Bound to this Region and account.
    const agentAccess = new iam.ManagedPolicy(this, "AgentAccess", {
      description: "What the AWS Replication Agent on the chapter 23 instance may do",
      statements: [
        new iam.PolicyStatement({
          sid: "InstallAndRegister",
          actions: [
            "drs:GetAgentInstallationAssetsForDrs",
            "drs:SendClientLogsForDrs",
            "drs:SendClientMetricsForDrs",
            "drs:CreateSourceServerForDrs",
          ],
          // The managed policy grants these on "*": there is no source server to name yet.
          resources: ["*"],
        }),
        new iam.PolicyStatement({
          sid: "TagOnCreate",
          actions: ["drs:TagResource"],
          resources: [sourceServers],
          conditions: { StringEquals: { "drs:CreateAction": "CreateSourceServerForDrs" } },
        }),
        new iam.PolicyStatement({
          sid: "Replicate",
          actions: [
            "drs:SendAgentMetricsForDrs",
            "drs:SendAgentLogsForDrs",
            "drs:UpdateAgentSourcePropertiesForDrs",
            "drs:UpdateAgentReplicationInfoForDrs",
            "drs:UpdateAgentConversionInfoForDrs",
            "drs:GetAgentCommandForDrs",
            "drs:GetAgentConfirmedResumeInfoForDrs",
            "drs:GetAgentRuntimeConfigurationForDrs",
            "drs:UpdateAgentBacklogForDrs",
            "drs:GetAgentReplicationInfoForDrs",
          ],
          resources: [sourceServers],
        }),
      ],
      // The role belongs to the chapter 23 stack. This attaches to it and changes nothing else.
      ...(config.sourceRoleName === undefined
        ? {}
        : { roles: [iam.Role.fromRoleName(this, "SourceRole", config.sourceRoleName)] }),
    });

    if (config.sourceSecurityGroupId !== undefined) {
      // Chapter 23 lets the instance out on 443 only. Replication is a second port.
      new ec2.CfnSecurityGroupEgress(this, "SourceToStaging", {
        groupId: config.sourceSecurityGroupId,
        ipProtocol: "tcp",
        fromPort: REPLICATION_PORT,
        toPort: REPLICATION_PORT,
        cidrIp: vpc.vpcCidrBlock,
        description: "Block replication to the staging area",
      });
    }
    // #endregion agent

    // #region templates
    // Only for a Region whose CloudFormation registry lists AWS::DRS. On 2026-10-13, ap-northeast-1 did not.
    if (config.templates === "declare") {
      const { pitPolicy, createPublicIP, ...replication } = replicationTemplate(
        config,
        staging.subnetId,
      );
      new drs.CfnReplicationConfigurationTemplate(this, "ReplicationTemplate", {
        ...replication,
        createPublicIp: createPublicIP,
        pitPolicy: pitPolicy.map(({ ruleID, ...rule }) => ({ ...rule, ruleId: ruleID })),
      });
      new drs.CfnLaunchConfigurationTemplate(this, "LaunchTemplate", launchTemplate());
    }
    // #endregion templates

    // #region events
    const logGroup = new logs.LogGroup(this, "EventLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, "EventRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Writes one log line per DRS event, and nothing else",
    });
    logGroup.grants.write(role);

    const onEvent = new nodejs.NodejsFunction(this, "OnDrsEvent", {
      entry: fileURLToPath(new URL("../../src/events-lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(10),
      role,
      logGroup,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        externalModules: [],
      },
    });

    new events.Rule(this, "DrsEvents", {
      description: "Launch results, stalled replication, and failback states from DRS",
      // The snapshot event fires every ten minutes per server. It is left out on purpose.
      eventPattern: { source: ["aws.drs"], detailType: Object.values(DETAIL_TYPES) },
      targets: [new targets.LambdaFunction(onEvent)],
    });
    // #endregion events

    new CfnOutput(this, "StagingSubnetId", { value: staging.subnetId });
    new CfnOutput(this, "StagingAvailabilityZone", { value: staging.availabilityZone });
    new CfnOutput(this, "AgentPolicyArn", { value: agentAccess.managedPolicyArn });
    new CfnOutput(this, "EventLogGroupName", { value: logGroup.logGroupName });
  }
}
