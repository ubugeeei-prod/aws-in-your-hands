import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dsql from "aws-cdk-lib/aws-dsql";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

// #region throttle
// Requests per second the API accepts, and how far a burst may go past it. Beyond that: 429.
export const THROTTLE = { rate: 10, burst: 20 } as const;
// #endregion throttle

export type SqlStackProps = StackProps & { allowedOrigin: string };

export class SqlStack extends Stack {
  constructor(scope: Construct, id: string, props: SqlStackProps) {
    super(scope, id, props);

    // #region cluster
    // No instance class, no subnet, no password: a single-Region cluster has
    // nothing else to choose. CDK has no higher-level construct for it yet.
    const cluster = new dsql.CfnCluster(this, "Notes", {
      // Exercise data. With protection on, destroying the stack would fail.
      deletionProtectionEnabled: false,
    });
    cluster.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // `Ref` is the cluster identifier. The host name and the ARN are built
    // from it, in the formats the Aurora DSQL user guide gives.
    const endpoint = Fn.join("", [cluster.ref, ".dsql.", this.region, ".on.aws"]);
    const clusterArn = this.formatArn({
      service: "dsql",
      resource: "cluster",
      resourceName: cluster.ref,
    });
    // #endregion cluster

    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region role
    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grantWrite(role);
    // May open a connection as a custom database role, on this one cluster.
    // Not dsql:DbConnectAdmin: the function never becomes `admin`. What it may
    // do once connected is decided inside the database, by GRANT.
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ["dsql:DbConnect"], resources: [clusterArn] }),
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
      // No `vpc`: the cluster endpoint is reached over the internet, with TLS
      // and an IAM-signed token.
      role,
      logGroup,
      environment: {
        ALLOWED_ORIGIN: props.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
        NOTES_DB: "dsql",
        DSQL_ENDPOINT: endpoint,
        DSQL_USER: "notes_api",
      },
      bundling: {
        // node-postgres is CommonJS and calls require() for Node's own modules.
        format: nodejs.OutputFormat.CJS,
        target: "node24",
        minify: false,
        sourceMap: false,
        // Bundle the AWS SDK too, so the token signer is the version in pnpm-lock.yaml.
        externalModules: [],
      },
    });
    // #endregion function

    const api = new apigwv2.HttpApi(this, "Api", {
      description: "Notes API on Aurora DSQL",
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

    // The HttpApi construct has no throttling option, so this reaches the stage it created.
    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: THROTTLE.rate,
      throttlingBurstLimit: THROTTLE.burst,
    };

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "ClusterEndpoint", { value: endpoint });
    // `vp run sql:db:grant` ties the database role to this IAM role.
    new CfnOutput(this, "HandlerRoleArn", { value: role.roleArn });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
