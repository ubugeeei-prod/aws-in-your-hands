import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

import { COST_TAGS, PROJECT_TAG_KEY } from "../../src/cost.ts";

export type LimitsStackProps = StackProps & {
  allowedOrigin: string;
  /** Off by default: an account must keep 100 unreserved, and a new account may not have them to spare. */
  reservedConcurrency?: number | undefined;
  monthlyBudgetUsd: number;
  budgetEmail?: string | undefined;
  /** Chapter 19's topic, if that stack is deployed. Without it the alarm shows in the console only. */
  alarmTopicArn?: string | undefined;
};

// #region bounds
// The limits this stack sets for itself, each far below the quota AWS sets for the account.
// Requests per second for the whole API, and for the one route that writes.
export const STAGE_THROTTLE = { rate: 10, burst: 20 } as const;
export const CREATE_THROTTLE = { rate: 2, burst: 4 } as const;
export const CREATE_ROUTE = "POST /notes";
// Request units per second the table accepts, as in chapters 05 and 19.
export const TABLE_CAP = { read: 150, write: 40 } as const;
// Above the worst case of three throttled attempts, below API Gateway's 30 seconds.
export const FUNCTION_TIMEOUT_SECONDS = 10;
// #endregion bounds

export class LimitsStack extends Stack {
  constructor(scope: Construct, id: string, props: LimitsStackProps) {
    super(scope, id, props);

    // #region tags
    // Every taggable resource below gets these. Cost Explorer can group by them once the
    // key is activated for billing, which no template can do.
    for (const [key, value] of Object.entries(COST_TAGS)) {
      Tags.of(this).add(key, value);
    }
    // #endregion tags

    const table = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // On-demand has no ceiling of its own. Past these, DynamoDB throttles instead of billing.
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
      memorySize: 256,
      timeout: Duration.seconds(FUNCTION_TIMEOUT_SECONDS),
      role,
      logGroup,
      // A brake: at most this many run at once, whatever arrives. It is also a reservation,
      // taken out of what the account's other functions may use.
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

    const api = new apigwv2.HttpApi(this, "Api", {
      description: "Notes API with its limits written down",
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
    const integration = new integrations.HttpLambdaIntegration("Notes", handler);
    api.addRoutes({ path: "/health", methods: [apigwv2.HttpMethod.GET], integration });
    const noteRoutes = api.addRoutes({
      path: "/notes",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration,
    });
    api.addRoutes({
      path: "/notes/{id}",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      integration,
    });

    // #region throttle
    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: STAGE_THROTTLE.rate,
      throttlingBurstLimit: STAGE_THROTTLE.burst,
    };
    // One route gets a stricter limit of its own. This property is plain JSON in
    // CloudFormation, so the names are written as the service spells them.
    stage.routeSettings = {
      [CREATE_ROUTE]: {
        ThrottlingRateLimit: CREATE_THROTTLE.rate,
        ThrottlingBurstLimit: CREATE_THROTTLE.burst,
      },
    };
    // A stage cannot name a route that does not exist yet.
    for (const route of noteRoutes) {
      stage.addDependency(route.node.defaultChild as apigwv2.CfnRoute);
    }
    // #endregion throttle

    // #region alarm
    // Lambda refused to start the function: the brake is on, or the account's concurrency is used up.
    const throttles = new cloudwatch.Alarm(this, "FunctionThrottled", {
      alarmDescription:
        "Lambda throttled the notes function. Look at ConcurrentExecutions and the reserved concurrency.",
      metric: handler.metricThrottles({ period: Duration.minutes(1), statistic: "Sum" }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    if (props.alarmTopicArn !== undefined) {
      const topic = sns.Topic.fromTopicArn(this, "AlarmTopic", props.alarmTopicArn);
      throttles.addAlarmAction(new cwActions.SnsAction(topic));
      throttles.addOkAction(new cwActions.SnsAction(topic));
    }
    // #endregion alarm

    // #region budget
    // Counts only what carries the tag. Until the tag key is activated for billing, that is nothing.
    new budgets.CfnBudget(this, "ProjectBudget", {
      budget: {
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: props.monthlyBudgetUsd, unit: "USD" },
        filterExpression: {
          tags: { key: PROJECT_TAG_KEY, values: [COST_TAGS.project], matchOptions: ["EQUALS"] },
        },
      },
      // A budget tells; it does not stop anything. Without an address it tells nobody.
      ...(props.budgetEmail === undefined
        ? {}
        : {
            notificationsWithSubscribers: [
              { notificationType: "ACTUAL", threshold: 80 },
              { notificationType: "FORECASTED", threshold: 100 },
            ].map((notification) => ({
              notification: {
                ...notification,
                comparisonOperator: "GREATER_THAN",
                thresholdType: "PERCENTAGE",
              },
              subscribers: [{ subscriptionType: "EMAIL", address: props.budgetEmail as string }],
            })),
          }),
    });
    // #endregion budget

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "FunctionName", { value: handler.functionName });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
