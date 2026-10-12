import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import { MODULE_FIRST, REQUIRE_BANNER, shared } from "../../src/bundle/variants.ts";
import { FUNCTION_TIMEOUT_SECONDS } from "../../src/timeouts.ts";

export type TuningStackProps = StackProps & {
  allowedOrigin: string;
  /** MB. CPU and the price per millisecond both follow it. */
  memorySize: number;
  /** The most environments the function may have. Costs nothing; may be refused in a new account. */
  reservedConcurrency?: number | undefined;
  /** Environments kept initialized. BILLED for every second they exist. */
  provisionedConcurrency?: number | undefined;
};

// The same bounds as chapters 05 and 19: anyone who knows the URL can call this API.
export const THROTTLE = { rate: 10, burst: 20 } as const;
export const TABLE_CAP = { read: 150, write: 40 } as const;

export class TuningStack extends Stack {
  constructor(scope: Construct, id: string, props: TuningStackProps) {
    super(scope, id, props);

    // The same table, role and routes as chapter 05. Only what differs is marked as a region.
    const table = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      maxReadRequestUnits: TABLE_CAP.read,
      maxWriteRequestUnits: TABLE_CAP.write,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
        ],
        resources: [table.tableArn],
      }),
    );

    // #region function
    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: props.memorySize,
      // Below API Gateway's 30 seconds, so the function never outlives its caller.
      timeout: Duration.seconds(FUNCTION_TIMEOUT_SECONDS),
      role,
      logGroup,
      // The report of each invocation arrives as an object with named numbers.
      loggingFormat: lambda.LoggingFormat.JSON,
      ...(props.reservedConcurrency === undefined
        ? {}
        : { reservedConcurrentExecutions: props.reservedConcurrency }),
      environment: {
        ALLOWED_ORIGIN: props.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
        NOTES_STORE: "dynamodb",
        TABLE_NAME: table.tableName,
      },
      // #region bundling
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: shared.target,
        // esbuild would follow `main` to the SDK's CommonJS build, which keeps every operation.
        mainFields: MODULE_FIRST,
        // Names in stack traces become short letters.
        minify: true,
        sourceMap: false,
        // Bundled, so the function runs the SDK in pnpm-lock.yaml and not the runtime's copy.
        externalModules: [],
        banner: REQUIRE_BANNER,
      },
      // #endregion bundling
    });
    // #endregion function

    // #region provisioned
    // Provisioned concurrency belongs to a version, never to $LATEST, so callers must
    // go through an alias. Without the option none of this exists and nothing is billed.
    const target: lambda.IFunction =
      props.provisionedConcurrency === undefined
        ? handler
        : new lambda.Alias(this, "Live", {
            aliasName: "live",
            version: handler.currentVersion,
            provisionedConcurrentExecutions: props.provisionedConcurrency,
          });
    // #endregion provisioned

    const api = new apigwv2.HttpApi(this, "Api", {
      description: "Notes API with the function's settings as options",
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["content-type"],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new integrations.HttpLambdaIntegration("Notes", target);
    api.addRoutes({ path: "/health", methods: [apigwv2.HttpMethod.GET], integration });
    api.addRoutes({
      path: "/notes",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration,
    });
    api.addRoutes({
      path: "/notes/{id}",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      integration,
    });

    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: THROTTLE.rate,
      throttlingBurstLimit: THROTTLE.burst,
    };

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
    new CfnOutput(this, "FunctionName", { value: handler.functionName });
  }
}
