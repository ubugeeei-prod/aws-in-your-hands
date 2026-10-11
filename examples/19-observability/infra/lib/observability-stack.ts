import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, LayerVersion, LoggingFormat, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
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
    const table = new Table(this, "Notes", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region logs
    const logGroup = new LogGroup(this, "HandlerLogs", {
      // How far back a query can look, and how much is stored. A week is a practice value.
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion logs

    const role = new Role(this, "HandlerRole", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
    logGroup.grantWrite(role);
    role.addToPolicy(
      new PolicyStatement({
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
    const handler = new NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role,
      logGroup,
      // Each log event is one JSON object, which a metric filter's JSON pattern needs.
      loggingFormat: LoggingFormat.JSON,
      // Lambda records its own segments for sampled invocations. Adds two
      // X-Ray actions on "*" to the role: they accept no narrower resource.
      tracing: Tracing.ACTIVE,
      environment: {
        ALLOWED_ORIGIN: props.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
        NOTES_STORE: "dynamodb",
        TABLE_NAME: table.tableName,
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        externalModules: [],
      },
    });
    // #endregion function

    // #region otel-layer
    if (props.otelLayerArn !== undefined) {
      handler.addLayers(LayerVersion.fromLayerVersionArn(this, "OtelLayer", props.otelLayerArn));
      // The layer's wrapper starts an OpenTelemetry SDK before the handler loads.
      handler.addEnvironment("AWS_LAMBDA_EXEC_WRAPPER", "/opt/otel-instrument");
      // Traces only. Application Signals is a separate feature with its own price.
      handler.addEnvironment("OTEL_AWS_APPLICATION_SIGNALS_ENABLED", "false");
    }
    // #endregion otel-layer

    const api = new HttpApi(this, "Api", {
      description: "Notes API with alarms, a dashboard and tracing",
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE],
        allowHeaders: ["content-type", "traceparent"],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new HttpLambdaIntegration("Notes", handler);
    api.addRoutes({ path: "/health", methods: [HttpMethod.GET], integration });
    api.addRoutes({ path: "/notes", methods: [HttpMethod.GET, HttpMethod.POST], integration });
    api.addRoutes({ path: "/notes/{id}", methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE], integration });

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
