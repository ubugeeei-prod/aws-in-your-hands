import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import type { Stage } from "./config.ts";

export type ShipApiStackProps = StackProps & { stage: Stage; allowedOrigin: string };

// Requests per second the API accepts, and how far a burst may go past it. Beyond that: 429.
export const THROTTLE = { rate: 10, burst: 20 } as const;

/** The chapter 04 API, as its own stack per stage, deployed through CloudFormation. */
export class ShipApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ShipApiStackProps) {
    // #region protection
    const production = props.stage === "prod";
    // Refuses DeleteStack until someone turns it off. It does not stop an update from deleting a resource.
    super(scope, id, { ...props, terminationProtection: production });
    // #endregion protection

    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: production ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy: production ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // #region role
    // Inline, not a separate AWS::IAM::Policy: drift detection compares what is on the role itself.
    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        WriteOwnLogs: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [logGroup.logGroupArn],
            }),
          ],
        }),
      },
    });
    // #endregion role

    const handler = new nodejs.NodejsFunction(this, "Handler", {
      // The handler is chapter 04's, unchanged. Only the way it is delivered differs.
      entry: fileURLToPath(import.meta.resolve("@aih/example-04-http-api/src/lambda.ts")),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role,
      logGroup,
      environment: { ALLOWED_ORIGIN: props.allowedOrigin, LOG_LEVEL: "info", STAGE: props.stage },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
      },
      // #region version
      // Each deploy that changes the function publishes a new version and keeps the old ones,
      // so there is something to point the alias back to.
      currentVersionOptions: { removalPolicy: RemovalPolicy.RETAIN },
    });

    // API Gateway invokes the alias, never $LATEST. Moving the alias is the switch.
    const live = new lambda.Alias(this, "Live", {
      aliasName: "live",
      version: handler.currentVersion,
    });
    // #endregion version

    const api = new apigwv2.HttpApi(this, "Api", {
      description: `Notes API (${props.stage})`,
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

    const integration = new integrations.HttpLambdaIntegration("Notes", live);
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

    // #region throttle
    // Every stage gets its own public URL, previews included, so every stage gets the bound.
    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: THROTTLE.rate,
      throttlingBurstLimit: THROTTLE.burst,
    };
    // #endregion throttle

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
    new CfnOutput(this, "LiveVersion", { value: live.version.version });
  }
}
