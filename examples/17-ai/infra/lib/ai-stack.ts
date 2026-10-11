import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, FunctionUrlAuthType, InvokeMode, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { modelArns, type VerifiedProfileId } from "./models.ts";

export type AiStackProps = StackProps & { profileId: VerifiedProfileId };

/** The app gives up on the model after this long. The function must outlive it to say so. */
export const INFERENCE_TIMEOUT = Duration.seconds(30);
export const MAX_OUTPUT_TOKENS = 400;

export class AiStack extends Stack {
  constructor(scope: Construct, id: string, props: AiStackProps) {
    super(scope, id, props);

    const logGroup = new LogGroup(this, "HandlerLogs", {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region role
    const role = new Role(this, "HandlerRole", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
    logGroup.grantWrite(role);

    const arns = modelArns(props.profileId, {
      partition: this.partition,
      region: this.region,
      account: this.account,
    });
    // ConverseStream is authorized as InvokeModelWithResponseStream. The
    // function never calls Converse, so it gets no bedrock:InvokeModel.
    role.addToPolicy(
      new PolicyStatement({
        actions: ["bedrock:InvokeModelWithResponseStream"],
        resources: [arns.profileArn],
      }),
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ["bedrock:InvokeModelWithResponseStream"],
        resources: arns.modelArns,
        // Only by way of the profile above: not the bare model, not another profile.
        conditions: { StringLike: { "bedrock:InferenceProfileArn": arns.profileArn } },
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
      // Lambda keeps running, and billing, after the caller hangs up. This is the hard stop.
      timeout: INFERENCE_TIMEOUT.plus(Duration.seconds(10)),
      role,
      logGroup,
      environment: {
        AI_BACKEND: "bedrock",
        BEDROCK_MODEL_ID: props.profileId,
        MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS),
        INFERENCE_TIMEOUT_MS: String(INFERENCE_TIMEOUT.toMilliseconds()),
        LOG_LEVEL: "info",
        STAGE: "dev",
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        // Bundle the AWS SDK too, so the function runs the version in pnpm-lock.yaml.
        externalModules: [],
        // The bundled AWS SDK still calls require(); an ESM bundle has none unless we provide it.
        banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
    // #endregion function

    // #region url
    const url = handler.addFunctionUrl({
      // Lambda checks a SigV4 signature before the function runs. With NONE,
      // anyone holding the URL could spend this account's money on inference.
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.RESPONSE_STREAM,
    });
    // #endregion url

    new CfnOutput(this, "FunctionUrl", { value: url.url });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
    new CfnOutput(this, "ModelId", { value: props.profileId });
  }
}
