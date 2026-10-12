import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

// #region throttle
// Requests per second the API accepts, and how far a burst may go past it. Beyond that: 429.
export const THROTTLE = { rate: 10, burst: 20 } as const;
// #endregion throttle

export type HttpApiStackProps = StackProps & { allowedOrigin: string };

export class HttpApiStack extends Stack {
  constructor(scope: Construct, id: string, props: HttpApiStackProps) {
    super(scope, id, props);

    // #region logs
    // Left to Lambda, the group would keep logs forever and outlive the stack.
    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion logs

    // #region role
    // CDK's default role may write to any log group in the account.
    // This one may write to the group above, and that is all.
    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grantWrite(role);
    // #endregion role

    // #region function
    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // HTTP API waits 30 seconds at most. Nobody receives a later answer.
      timeout: Duration.seconds(10),
      role,
      logGroup,
      environment: {
        ALLOWED_ORIGIN: props.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
      },
      // Bundled by esbuild during synth. No Docker.
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
      },
    });
    // #endregion function

    // #region api
    const api = new apigwv2.HttpApi(this, "Api", {
      description: "Notes API",
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["content-type"],
        maxAge: Duration.hours(1),
      },
    });

    // Listed one by one, so API Gateway answers every other path itself
    // without invoking (and billing) the function.
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
    // #endregion api

    // #region stage
    // The HttpApi construct has no throttling option, so this reaches the stage it created.
    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: THROTTLE.rate,
      throttlingBurstLimit: THROTTLE.burst,
    };
    // #endregion stage

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
