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

import { Monitoring } from "./monitoring.ts";

export type ObservabilityStackProps = StackProps & {
  allowedOrigin: string;
  alarmEmail?: string | undefined;
  /** ARN of the AWS Lambda Layer for OpenTelemetry (Node.js) in this Region. Without it, no spans from the code. */
  otelLayerArn?: string | undefined;
};

export class ObservabilityStack extends Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    // The same table, role and routes as chapter 05. Only what differs is marked as a region.
    const table = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region logs
    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      // How far back a query can look, and how much is stored. A week is a practice value.
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion logs

    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grantWrite(role);
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
      memorySize: 256,
      timeout: Duration.seconds(10),
      role,
      logGroup,
      // Each log event is one JSON object, which a metric filter's JSON pattern needs.
      loggingFormat: lambda.LoggingFormat.JSON,
      // Lambda records its own segments for sampled invocations. Adds two
      // X-Ray actions on "*" to the role: they accept no narrower resource.
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        ALLOWED_ORIGIN: props.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
        NOTES_STORE: "dynamodb",
        TABLE_NAME: table.tableName,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        externalModules: [],
        // The bundled AWS SDK still calls require(); an ESM bundle has none unless we provide it.
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
    // #endregion function

    // #region otel-layer
    if (props.otelLayerArn !== undefined) {
      handler.addLayers(
        lambda.LayerVersion.fromLayerVersionArn(this, "OtelLayer", props.otelLayerArn),
      );
      // The layer's wrapper starts an OpenTelemetry SDK before the handler loads.
      handler.addEnvironment("AWS_LAMBDA_EXEC_WRAPPER", "/opt/otel-instrument");
      // Traces only. Application Signals is a separate feature with its own price.
      handler.addEnvironment("OTEL_AWS_APPLICATION_SIGNALS_ENABLED", "false");
    }
    // #endregion otel-layer

    const api = new apigwv2.HttpApi(this, "Api", {
      description: "Notes API with alarms, a dashboard and tracing",
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["content-type", "traceparent"],
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
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      integration,
    });

    // #region monitoring
    const monitoring = new Monitoring(this, "Monitoring", {
      api,
      handler,
      table,
      logGroup,
      alarmEmail: props.alarmEmail,
    });
    // #endregion monitoring

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
    new CfnOutput(this, "AlarmTopicArn", { value: monitoring.topic.topicArn });
    new CfnOutput(this, "DashboardName", { value: monitoring.dashboard.dashboardName });
  }
}
