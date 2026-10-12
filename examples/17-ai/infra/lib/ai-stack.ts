import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import * as v from "valibot";

import { modelArns, type VerifiedProfileId } from "./models.ts";

export type AiStackProps = StackProps & {
  profileId: VerifiedProfileId;
  /** At most this many summaries run at once. From `-c reservedConcurrency=N`. */
  reservedConcurrency?: number | undefined;
};

// #region reserved
// Off unless asked for. Reserving takes N out of the account's concurrency, and an account
// with a low limit refuses the deploy.
const WHOLE = "must be a whole number such as 2";
const reservedConcurrencySchema = v.optional(
  v.pipe(
    // `-c` hands over text. A value written in cdk.json may be a number already.
    v.union([v.string(), v.number()], WHOLE),
    v.transform(Number),
    v.number(WHOLE),
    v.integer(WHOLE),
    v.minValue(1, "must be 1 or more: 0 would stop every summary"),
    v.maxValue(1000),
  ),
);

/** Reads `-c reservedConcurrency=N`. Absent means no reservation. */
export function parseReservedConcurrency(value: unknown): number | undefined {
  const result = v.safeParse(reservedConcurrencySchema, value);
  if (!result.success) {
    throw new Error(`reservedConcurrency ${result.issues[0]?.message ?? "is not valid"}`);
  }
  return result.output;
}
// #endregion reserved

/** The app gives up on the model after this long. The function must outlive it to say so. */
export const INFERENCE_TIMEOUT = Duration.seconds(30);
export const MAX_OUTPUT_TOKENS = 400;

export class AiStack extends Stack {
  constructor(scope: Construct, id: string, props: AiStackProps) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region role
    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grantWrite(role);

    const arns = modelArns(props.profileId, {
      partition: this.partition,
      region: this.region,
      account: this.account,
    });
    // ConverseStream is authorized as InvokeModelWithResponseStream. The
    // function never calls Converse, so it gets no bedrock:InvokeModel.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModelWithResponseStream"],
        resources: [arns.profileArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModelWithResponseStream"],
        resources: arns.modelArns,
        // Only by way of the profile above: not the bare model, not another profile.
        conditions: { StringLike: { "bedrock:InferenceProfileArn": arns.profileArn } },
      }),
    );
    // #endregion role

    // #region function
    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // Lambda keeps running, and billing, after the caller hangs up. This is the hard stop.
      timeout: INFERENCE_TIMEOUT.plus(Duration.seconds(10)),
      role,
      logGroup,
      // Nothing else limits how many callers run the model at once. Past it, Lambda refuses the call.
      ...(props.reservedConcurrency === undefined
        ? {}
        : { reservedConcurrentExecutions: props.reservedConcurrency }),
      environment: {
        AI_BACKEND: "bedrock",
        BEDROCK_MODEL_ID: props.profileId,
        MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS),
        INFERENCE_TIMEOUT_MS: String(INFERENCE_TIMEOUT.toMilliseconds()),
        LOG_LEVEL: "info",
        STAGE: "dev",
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        // Bundle the AWS SDK too, so the function runs the version in pnpm-lock.yaml.
        externalModules: [],
        // The bundled AWS SDK still calls require(); an ESM bundle has none unless we provide it.
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
    // #endregion function

    // #region url
    const url = handler.addFunctionUrl({
      // Lambda checks a SigV4 signature before the function runs. With NONE,
      // anyone holding the URL could spend this account's money on inference.
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });
    // #endregion url

    new CfnOutput(this, "FunctionUrl", { value: url.url });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
    new CfnOutput(this, "ModelId", { value: props.profileId });
  }
}
