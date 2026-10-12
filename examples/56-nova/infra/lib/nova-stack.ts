import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { KEY_PREFIX } from "@aih/example-07-uploads/api/src/keys.ts";

import { explainUnknown, iamResources, routesFor } from "../../src/catalog.ts";
import { DESCRIBE_NEED } from "../../src/env.ts";
import { CLAIM_PREFIX, GENERATED_PREFIX } from "../../src/media.ts";

export type NovaStackProps = StackProps & {
  /** A route from ap-northeast-1 to a model that reads an image. From `-c describeModel=...`. */
  describeModel: string;
};

/** The app gives up on the model after this long. The function must outlive it to say so. */
export const INFERENCE_TIMEOUT = Duration.seconds(30);
/** A claim outlives the function, so a function that was killed cannot still be running. */
export const LEASE = Duration.seconds(60);
export const MAX_OUTPUT_TOKENS = 300;

export class NovaStack extends Stack {
  constructor(scope: Construct, id: string, props: NovaStackProps) {
    super(scope, id, props);

    // #region model
    // An ID nobody checked would need IAM resources nobody checked. Retired models stop here too.
    const resolved = routesFor(DESCRIBE_NEED).find(({ route }) => route.id === props.describeModel);
    if (resolved === undefined) {
      throw new Error(
        `describeModel: ${explainUnknown(props.describeModel)}. Routes that describe an image: ${routesFor(
          DESCRIBE_NEED,
        )
          .map(({ route }) => route.id)
          .join(", ")}`,
      );
    }
    // #endregion model

    // #region bucket
    const media = new s3.Bucket(this, "Media", {
      // No bucket policy and no ACL can make an object public.
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          // A claim is deleted by the request that made it. One left behind by a crash
          // is ignored once its lease has run out, and removed here a day later.
          id: "expire-abandoned-claims",
          prefix: CLAIM_PREFIX,
          expiration: Duration.days(1),
        },
        {
          id: "abort-incomplete-multipart-uploads",
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      // Exercise data: deleted with the stack, once emptied. Real uploads want RETAIN.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion bucket

    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region role
    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);

    // Uploads are read and never written. Bedrock fetches the image named in the request
    // with this same role, so this statement is also what lets the model see it.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [media.arnForObjects(`${KEY_PREFIX}*`)],
      }),
    );
    // What the function writes: descriptions and claims. If-Match on a write needs GetObject too.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [
          media.arnForObjects(`${GENERATED_PREFIX}*`),
          media.arnForObjects(`${CLAIM_PREFIX}*`),
        ],
      }),
    );
    // As in chapter 07: with this, a missing key is a 404 and not a 403.
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [media.bucketArn] }),
    );

    // Converse is authorized as bedrock:InvokeModel. Nothing here streams.
    const arns = iamResources(resolved, {
      partition: this.partition,
      region: this.region,
      account: this.account,
    });
    if (arns.profileArn === undefined) {
      // In-Region: there is no profile. The model in this Region is the whole resource.
      role.addToPolicy(
        new iam.PolicyStatement({ actions: ["bedrock:InvokeModel"], resources: arns.modelArns }),
      );
    } else {
      role.addToPolicy(
        new iam.PolicyStatement({ actions: ["bedrock:InvokeModel"], resources: [arns.profileArn] }),
      );
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel"],
          resources: arns.modelArns,
          // Only by way of the profile above: not the bare model, not another profile.
          conditions: { StringLike: { "bedrock:InferenceProfileArn": arns.profileArn } },
        }),
      );
    }
    // #endregion role

    // #region function
    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: INFERENCE_TIMEOUT.plus(Duration.seconds(10)),
      role,
      logGroup,
      environment: {
        NOVA_BACKEND: "bedrock",
        DESCRIBE_MODEL_ID: resolved.route.id,
        MEDIA_BUCKET: media.bucketName,
        MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS),
        INFERENCE_TIMEOUT_MS: String(INFERENCE_TIMEOUT.toMilliseconds()),
        LEASE_SECONDS: String(LEASE.toSeconds()),
        DESCRIPTION_LANGUAGE: "ja",
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
    // Lambda checks a SigV4 signature before the function runs. With NONE, anyone holding
    // the URL could spend this account's money on inference.
    const url = handler.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });
    // #endregion function

    new CfnOutput(this, "FunctionUrl", { value: url.url });
    new CfnOutput(this, "MediaBucketName", { value: media.bucketName });
    new CfnOutput(this, "DescribeModelId", { value: resolved.route.id });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
