import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as appconfig from "aws-cdk-lib/aws-appconfig";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

// Requests per second the API accepts, and how far a burst may go past it. Beyond that: 429.
export const THROTTLE = { rate: 10, burst: 20 } as const;

// #region extension
// The AppConfig Agent Lambda extension 2.0.22365 for arm64 in ap-northeast-1, from the
// version table in the AppConfig User Guide. Pinned like every other dependency of this book.
export const APPCONFIG_EXTENSION_ARN =
  "arn:aws:lambda:ap-northeast-1:980059726660:layer:AWS-AppConfig-Extension-Arm64:231";
// #endregion extension

export type ProgressiveStackProps = StackProps & {
  allowedOrigin: string;
  /** Share of requests the deployed build answers with a 500. For practising a rollback. */
  faultPercent: number;
};

export class ProgressiveStack extends Stack {
  constructor(scope: Construct, id: string, props: ProgressiveStackProps) {
    super(scope, id, props);

    // #region flags
    const application = new appconfig.Application(this, "FlagsApplication", {
      applicationName: "aih-notes",
      description: "Feature flags of the notes API",
    });
    // L1: the L2 for a hosted profile also stores a version, and versions here belong to flags:deploy.
    const profile = new appconfig.CfnConfigurationProfile(this, "FlagsProfile", {
      applicationId: application.applicationId,
      name: "flags",
      locationUri: "hosted",
      type: "AWS.AppConfig.FeatureFlags",
    });
    // A fifth of the execution environments every minute, then five more minutes under the alarms.
    const strategy = new appconfig.DeploymentStrategy(this, "FlagsStrategy", {
      deploymentStrategyName: "aih-linear-20-percent-every-minute",
      rolloutStrategy: appconfig.RolloutStrategy.linear({
        growthFactor: 20,
        deploymentDuration: Duration.minutes(5),
        finalBakeTime: Duration.minutes(5),
      }),
    });
    // #endregion flags

    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);

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
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(
          this,
          "AppConfigExtension",
          APPCONFIG_EXTENSION_ARN,
        ),
      ],
      environment: {
        ALLOWED_ORIGIN: props.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
        FAULT_PERCENT: String(props.faultPercent),
        FLAGS_APPLICATION: application.applicationId,
        FLAGS_ENVIRONMENT: "dev",
        FLAGS_PROFILE: profile.ref,
        // The extension fetches the flags while the function is still starting.
        AWS_APPCONFIG_EXTENSION_PREFETCH_LIST: `/applications/${application.applicationId}/environments/dev/configurations/${profile.ref}`,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
      },
    });
    // #endregion function

    // #region alias
    // Published once, when the stack is created. Later deploys change $LATEST and leave this alone:
    // publishing the next version and moving the alias to it is the job of rollout:start.
    const first = new lambda.Version(this, "FirstVersion", {
      lambda: handler,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const live = new lambda.Alias(this, "Live", { aliasName: "live", version: first });
    // #endregion alias

    const api = new apigwv2.HttpApi(this, "Api", {
      description: "Notes API behind a weighted alias",
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
    // API Gateway invokes the alias, never $LATEST. A request reaches new code only through the alias.
    const integration = new integrations.HttpLambdaIntegration("Notes", live);
    api.addRoutes({ path: "/health", methods: [apigwv2.HttpMethod.GET], integration });
    api.addRoutes({ path: "/stats", methods: [apigwv2.HttpMethod.GET], integration });
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

    // #region alarms
    // One minute, one bad data point. Strict on purpose: these alarms decide, they do not page anyone.
    const watch = { period: Duration.minutes(1), statistic: cloudwatch.Stats.SUM };
    const alarms = [
      // Crashes and timeouts of whichever version the alias sent the request to.
      new cloudwatch.Alarm(this, "FunctionErrors", {
        alarmName: `${id}-function-errors`,
        metric: live.metricErrors(watch),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // No requests is not a failure. It is also not evidence of health: see the bake time.
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      // A 500 that the application answered itself is a successful invocation to Lambda.
      new cloudwatch.Alarm(this, "ApiServerErrors", {
        alarmName: `${id}-api-5xx`,
        metric: api.metricServerError(watch),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    ];
    // #endregion alarms

    // #region environment
    // AppConfig may read the two alarms, and nothing else.
    const monitorRole = new iam.Role(this, "FlagsMonitorRole", {
      assumedBy: new iam.ServicePrincipal("appconfig.amazonaws.com"),
      inlinePolicies: {
        ReadAlarms: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["cloudwatch:DescribeAlarms"],
              resources: alarms.map((alarm) => alarm.alarmArn),
            }),
          ],
        }),
      },
    });
    // The same alarms that stop a code shift roll a flag deployment back.
    const environment = new appconfig.Environment(this, "FlagsEnvironment", {
      application,
      environmentName: "dev",
      monitors: alarms.map((alarm) => appconfig.Monitor.fromCloudWatchAlarm(alarm, monitorRole)),
    });

    // The function may read this one configuration in this one environment. A policy of its own,
    // because the role's default policy is created before the function, and the environment after.
    new iam.Policy(this, "ReadFlags", {
      roles: [role],
      statements: [
        new iam.PolicyStatement({
          actions: ["appconfig:StartConfigurationSession", "appconfig:GetLatestConfiguration"],
          resources: [
            this.formatArn({
              service: "appconfig",
              resource: "application",
              resourceName: `${application.applicationId}/environment/${environment.environmentId}/configuration/${profile.ref}`,
            }),
          ],
        }),
      ],
    });
    // #endregion environment

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "FunctionName", { value: handler.functionName });
    new CfnOutput(this, "AliasName", { value: live.aliasName });
    new CfnOutput(this, "AlarmNames", { value: alarms.map((alarm) => alarm.alarmName).join(",") });
    new CfnOutput(this, "FlagsApplicationId", { value: application.applicationId });
    new CfnOutput(this, "FlagsEnvironmentId", { value: environment.environmentId });
    new CfnOutput(this, "FlagsProfileId", { value: profile.ref });
    new CfnOutput(this, "FlagsStrategyId", { value: strategy.deploymentStrategyId });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
