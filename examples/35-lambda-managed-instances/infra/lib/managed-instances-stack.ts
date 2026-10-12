import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";

import { FUNCTION_MEMORY_MB, type ManagedConfig } from "../../src/config.ts";

// Requests per second the API accepts, and how far a burst may go past it. The same as chapter 04.
export const THROTTLE = { rate: 10, burst: 20 } as const;

export type ManagedInstancesStackProps = StackProps & { config: ManagedConfig };

export class ManagedInstancesStack extends Stack {
  constructor(scope: Construct, id: string, props: ManagedInstancesStackProps) {
    super(scope, id, props);
    const { config } = props;

    // #region network
    // The chapter 11 VPC, read by export name. The instances go into its private subnets, one per zone.
    const vpc = importNetwork(this, "Network");

    // Lambda reaches the instances without an inbound rule. Outbound, they need HTTPS and nothing else.
    const securityGroup = new ec2.SecurityGroup(this, "InstanceSecurityGroup", {
      vpc,
      description: "Chapter 35 managed instances: nothing in, HTTPS out",
      allowAllOutbound: false,
    });
    securityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS to AWS APIs");
    // #endregion network

    // #region operator-role
    // Not the role the function runs as: the role Lambda assumes to launch instances in this account.
    const operatorRole = new iam.Role(this, "OperatorRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Lets Lambda launch and tag the instances of the chapter 35 capacity provider",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AWSLambdaManagedEC2ResourceOperator"),
      ],
    });
    // #endregion operator-role

    // #region capacity-provider
    // Left to Lambda, the group would be created outside the stack and outlive it.
    const systemLogs = new logs.LogGroup(this, "CapacityProviderLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const capacityProvider = new lambda.CapacityProvider(this, "CapacityProvider", {
      subnets: vpc.isolatedSubnets,
      securityGroups: [securityGroup],
      operatorRole,
      architectures: [lambda.Architecture.ARM_64],
      // One type, so the bill can be worked out beforehand. Lambda's guide prefers a wider choice.
      instanceTypeFilter: lambda.InstanceTypeFilter.allow([
        new ec2.InstanceType(config.instanceType),
      ]),
      // The ceiling on what Lambda may launch, and so on what this stack can cost.
      maxVCpuCount: config.maxVCpuCount,
      scalingOptions: lambda.ScalingOptions.auto(),
      logGroup: systemLogs,
    });
    // #endregion capacity-provider

    // #region function
    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);

    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      // Managed Instances takes Node.js 22 and later.
      runtime: lambda.Runtime.NODEJS_24_X,
      // Has to match the capacity provider.
      architecture: lambda.Architecture.ARM_64,
      // The floor on Managed Instances. Chapter 04 ran the same code in 256 MB.
      memorySize: FUNCTION_MEMORY_MB,
      // A request that times out is reported as failed, and its code keeps running.
      timeout: Duration.seconds(10),
      role,
      logGroup,
      environment: {
        ALLOWED_ORIGIN: config.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
      },
    });

    // Writes CapacityProviderConfig and FunctionScalingConfig on the function, and publishes $LATEST.PUBLISHED.
    capacityProvider.addFunction(handler, {
      latestPublishedScalingConfig: {
        minExecutionEnvironments: config.minExecutionEnvironments,
        maxExecutionEnvironments: config.maxExecutionEnvironments,
      },
    });
    // #endregion function

    // #region api
    const api = new apigwv2.HttpApi(this, "Api", {
      description: "Notes API on Lambda Managed Instances",
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

    // The unqualified function: on Managed Instances that means $LATEST.PUBLISHED, not $LATEST.
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

    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: THROTTLE.rate,
      throttlingBurstLimit: THROTTLE.burst,
    };
    // #endregion api

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "CapacityProviderName", { value: capacityProvider.capacityProviderName });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
    new CfnOutput(this, "CapacityProviderLogGroupName", { value: systemLogs.logGroupName });
  }
}
