import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

export type HttpApiStackProps = StackProps & { allowedOrigin: string };

export class HttpApiStack extends Stack {
  constructor(scope: Construct, id: string, props: HttpApiStackProps) {
    super(scope, id, props);

    // #region logs
    // Left to Lambda, the group would keep logs forever and outlive the stack.
    const logGroup = new LogGroup(this, "HandlerLogs", {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion logs

    // #region role
    // CDK's default role may write to any log group in the account.
    // This one may write to the group above, and that is all.
    const role = new Role(this, "HandlerRole", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
    logGroup.grantWrite(role);
    // #endregion role

    // #region function
    const handler = new NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
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
      bundling: { format: OutputFormat.ESM, target: "node24", minify: false, sourceMap: false },
    });
    // #endregion function

    // #region api
    const api = new HttpApi(this, "Api", {
      description: "Notes API",
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.DELETE],
        allowHeaders: ["content-type"],
        maxAge: Duration.hours(1),
      },
    });

    // Listed one by one, so API Gateway answers every other path itself
    // without invoking (and billing) the function.
    const integration = new HttpLambdaIntegration("Notes", handler);
    api.addRoutes({ path: "/health", methods: [HttpMethod.GET], integration });
    api.addRoutes({ path: "/notes", methods: [HttpMethod.GET, HttpMethod.POST], integration });
    api.addRoutes({ path: "/notes/{id}", methods: [HttpMethod.GET, HttpMethod.DELETE], integration });
    // #endregion api

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
