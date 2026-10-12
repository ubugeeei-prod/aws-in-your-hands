import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Alias, Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import type { Stage } from "./config.ts";

export type ShipApiStackProps = StackProps & { stage: Stage; allowedOrigin: string };

/** The chapter 04 API, as its own stack per stage, deployed through CloudFormation. */
export class ShipApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ShipApiStackProps) {
    // #region protection
    const production = props.stage === "prod";
    // Refuses DeleteStack until someone turns it off. It does not stop an update from deleting a resource.
    super(scope, id, { ...props, terminationProtection: production });
    // #endregion protection

    const logGroup = new LogGroup(this, "HandlerLogs", {
      retention: production ? RetentionDays.ONE_MONTH : RetentionDays.ONE_WEEK,
      removalPolicy: production ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // #region role
    // Inline, not a separate AWS::IAM::Policy: drift detection compares what is on the role itself.
    const role = new Role(this, "HandlerRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        WriteOwnLogs: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [logGroup.logGroupArn],
            }),
          ],
        }),
      },
    });
    // #endregion role

    const handler = new NodejsFunction(this, "Handler", {
      // The handler is chapter 04's, unchanged. Only the way it is delivered differs.
      entry: fileURLToPath(import.meta.resolve("@aih/example-04-http-api/src/lambda.ts")),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role,
      logGroup,
      environment: { ALLOWED_ORIGIN: props.allowedOrigin, LOG_LEVEL: "info", STAGE: props.stage },
      bundling: { format: OutputFormat.ESM, target: "node24", minify: false, sourceMap: false },
      // #region version
      // Each deploy that changes the function publishes a new version and keeps the old ones,
      // so there is something to point the alias back to.
      currentVersionOptions: { removalPolicy: RemovalPolicy.RETAIN },
    });

    // API Gateway invokes the alias, never $LATEST. Moving the alias is the switch.
    const live = new Alias(this, "Live", { aliasName: "live", version: handler.currentVersion });
    // #endregion version

    const api = new HttpApi(this, "Api", {
      description: `Notes API (${props.stage})`,
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.DELETE],
        allowHeaders: ["content-type"],
        maxAge: Duration.hours(1),
      },
    });

    const integration = new HttpLambdaIntegration("Notes", live);
    api.addRoutes({ path: "/health", methods: [HttpMethod.GET], integration });
    api.addRoutes({ path: "/notes", methods: [HttpMethod.GET, HttpMethod.POST], integration });
    api.addRoutes({
      path: "/notes/{id}",
      methods: [HttpMethod.GET, HttpMethod.DELETE],
      integration,
    });

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
    new CfnOutput(this, "LiveVersion", { value: live.version.version });
  }
}
