import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import { THROTTLE } from "@aih/example-04-http-api/infra/lib/http-api-stack.ts";
import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";

import { ACCESS_POINT, type EfsConfig, MOUNT_PATH, NFS_PORT } from "../../src/config.ts";

// #region vpc-actions
/** From "Giving Lambda functions access to resources in an Amazon VPC", read on 2026-10-13. */
export const VPC_ATTACH_ACTIONS = [
  "ec2:CreateNetworkInterface",
  "ec2:DescribeNetworkInterfaces",
  "ec2:DescribeSubnets",
  "ec2:DeleteNetworkInterface",
  "ec2:AssignPrivateIpAddresses",
  "ec2:UnassignPrivateIpAddresses",
] as const;
// #endregion vpc-actions

export type EfsStackProps = StackProps & { config: EfsConfig };

export class EfsStack extends Stack {
  constructor(scope: Construct, id: string, props: EfsStackProps) {
    super(scope, id, props);
    const { config } = props;
    const removalPolicy =
      config.dataOnDestroy === "retain" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // #region network
    // The chapter 11 VPC, read by export name. Its private subnets: one per zone, no way out.
    const vpc = importNetwork(this, "Network");
    const subnets = vpc.isolatedSubnets;

    // Two groups that name each other: NFS leaves the function only towards the mount
    // targets, and reaches the mount targets only from the function.
    const functionGroup = new ec2.SecurityGroup(this, "FunctionGroup", {
      vpc,
      description: "Chapter 53 function: NFS to the mount targets, nothing else",
      allowAllOutbound: false,
    });
    const mountTargetGroup = new ec2.SecurityGroup(this, "MountTargetGroup", {
      vpc,
      description: "Chapter 53 mount targets: NFS from the function, nothing else",
      allowAllOutbound: false,
    });
    functionGroup.addEgressRule(mountTargetGroup, ec2.Port.tcp(NFS_PORT), "NFS to EFS");
    mountTargetGroup.addIngressRule(functionGroup, ec2.Port.tcp(NFS_PORT), "NFS from the function");
    // #endregion network

    // #region file-system
    const fileSystem = new efs.CfnFileSystem(this, "Notes", {
      // Cannot be changed after creation, and off unless asked for through the API.
      encrypted: true,
      performanceMode: "generalPurpose",
      // Pay per gigabyte read and written. Nothing is billed for throughput while idle.
      throughputMode: "elastic",
      // No lifecycle policy: a note is a few kilobytes, and Infrequent Access bills every file as 128 KiB.
      backupPolicy: { status: config.backup ? "ENABLED" : "DISABLED" },
      // Any policy at all ends the default, where whoever reaches a mount target may mount as anyone.
      // This one grants nothing, so access has to come from an IAM role, and it refuses plain NFS.
      fileSystemPolicy: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "RefuseUnencryptedTransport",
            Effect: "Deny",
            Principal: { AWS: "*" },
            Action: "*",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          },
        ],
      },
      fileSystemTags: [{ key: "Name", value: `${id}/notes` }],
    });
    fileSystem.applyRemovalPolicy(removalPolicy);

    // One mount target per zone: an address in that zone's subnet that speaks NFS.
    const mountTargets = subnets.map(
      (subnet, index) =>
        new efs.CfnMountTarget(this, `MountTarget${index + 1}`, {
          fileSystemId: fileSystem.ref,
          subnetId: subnet.subnetId,
          securityGroups: [mountTargetGroup.securityGroupId],
        }),
    );
    // #endregion file-system

    // #region access-point
    // The function sees this directory as "/", and every file it touches belongs to this user.
    const accessPoint = new efs.CfnAccessPoint(this, "NotesApp", {
      fileSystemId: fileSystem.ref,
      posixUser: { uid: ACCESS_POINT.uid, gid: ACCESS_POINT.gid },
      rootDirectory: {
        path: ACCESS_POINT.path,
        // EFS creates the directory on first use, but only when all three are given.
        creationInfo: {
          ownerUid: ACCESS_POINT.uid,
          ownerGid: ACCESS_POINT.gid,
          permissions: ACCESS_POINT.permissions,
        },
      },
      accessPointTags: [{ key: "Name", value: `${id}/notes-app` }],
    });
    // #endregion access-point

    // #region role
    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);
    // Mount and write, on this file system, and only when coming in through this access point.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"],
        resources: [fileSystem.attrArn],
        conditions: {
          StringEquals: { "elasticfilesystem:AccessPointArn": accessPoint.attrArn },
        },
      }),
    );
    // Lambda uses the function's role to create its network interfaces in the VPC.
    // The Lambda guide lists these six and says they must be allowed on all resources.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [...VPC_ATTACH_ACTIONS],
        resources: ["*"],
      }),
    );
    // #endregion role

    // #region function
    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role,
      logGroup,
      vpc,
      vpcSubnets: { subnets },
      securityGroups: [functionGroup],
      environment: {
        ALLOWED_ORIGIN: config.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
        NOTES_DIR: MOUNT_PATH,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
      },
    });
    // The construct's `filesystem` option would add its own statements to the role, one of them on "*".
    const cfnHandler = handler.node.defaultChild as lambda.CfnFunction;
    cfnHandler.fileSystemConfigs = [{ arn: accessPoint.attrArn, localMountPath: MOUNT_PATH }];
    // Lambda checks the mount targets when the function is created, so they come first.
    for (const mountTarget of mountTargets) {
      handler.node.addDependency(mountTarget);
    }
    // #endregion function

    // #region api
    const api = new apigwv2.HttpApi(this, "Api", {
      description: "Notes API on EFS",
      corsPreflight: {
        allowOrigins: [config.allowedOrigin],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["content-type"],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new integrations.HttpLambdaIntegration("Notes", handler);
    api.addRoutes({ path: "/health", methods: [apigwv2.HttpMethod.GET], integration });
    api.addRoutes({
      path: "/notes",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration,
    });
    api.addRoutes({
      path: "/notes/{id}",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.DELETE],
      integration,
    });
    // Anyone can POST, and every note is stored and billed: the same brake as chapter 04.
    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: THROTTLE.rate,
      throttlingBurstLimit: THROTTLE.burst,
    };
    // #endregion api

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "FileSystemId", { value: fileSystem.ref });
    new CfnOutput(this, "AccessPointId", { value: accessPoint.ref });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
