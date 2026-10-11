import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

export type NotesStackProps = StackProps & { allowedOrigin: string };

export class NotesStack extends Stack {
  constructor(scope: Construct, id: string, props: NotesStackProps) {
    super(scope, id, props);

    // #region table
    const table = new Table(this, "Notes", {
      // Generic key names: what goes into them is decided by the access
      // patterns in src/dynamodb-repository.ts, and can grow without
      // recreating the table.
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      // On-demand: billed per request, nothing to size in advance, and no
      // charge for throughput while nobody uses the table.
      billingMode: BillingMode.PAY_PER_REQUEST,
      // Exercise data. The table and every note in it are deleted with the
      // stack. Real data wants RETAIN, deletion protection, and point-in-time
      // recovery, which chapter 22 covers.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion table

    const logGroup = new LogGroup(this, "HandlerLogs", {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region role
    const role = new Role(this, "HandlerRole", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
    logGroup.grantWrite(role);
    // The five operations the repository performs, on this one table.
    // `table.grantReadWriteData(role)` would be shorter, and would also allow
    // Scan and the batch operations, which no code path here uses.
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
    // #endregion role

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
      environment: {
        ALLOWED_ORIGIN: props.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
        NOTES_STORE: "dynamodb",
        // The table's name is generated at deploy time. The function learns it
        // here; nothing in the code hard-codes it.
        TABLE_NAME: table.tableName,
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        // By default the AWS SDK is left out of the bundle and the copy that
        // ships with the Lambda runtime is used, whatever version that is.
        // Bundling it means the function runs the SDK version in pnpm-lock.yaml.
        externalModules: [],
      },
    });
    // #endregion function

    const api = new HttpApi(this, "Api", {
      description: "Notes API",
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE],
        allowHeaders: ["content-type"],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new HttpLambdaIntegration("Notes", handler);
    api.addRoutes({ path: "/health", methods: [HttpMethod.GET], integration });
    api.addRoutes({ path: "/notes", methods: [HttpMethod.GET, HttpMethod.POST], integration });
    api.addRoutes({ path: "/notes/{id}", methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE], integration });

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
