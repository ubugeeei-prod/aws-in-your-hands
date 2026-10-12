import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { AUDIO_PREFIX, CLAIM_PREFIX } from "../../src/cache-key.ts";

/** Shorter than a claim is left alone (CLAIM_MS): a function that holds one is stopped before it lapses. */
export const HANDLER_TIMEOUT = Duration.seconds(60);
/** Audio nobody asked for again in this time is made again on the next request. */
export const AUDIO_DAYS = 30;

export class PollyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // #region bucket
    const cache = new s3.Bucket(this, "Cache", {
      // Read only through URLs the function signs. No policy or ACL can make an object public.
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: "expire-audio",
          // The audio is a note's text in another form. It does not outlive the note for long.
          prefix: AUDIO_PREFIX,
          expiration: Duration.days(AUDIO_DAYS),
        },
        {
          id: "expire-claims",
          // A claim matters for 90 seconds. One day is the shortest a rule can say.
          prefix: CLAIM_PREFIX,
          expiration: Duration.days(1),
        },
      ],
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
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["polly:SynthesizeSpeech"],
        // Polly has no resource for a voice or an engine. The only resource type this action
        // knows is a lexicon, and the function uses none.
        resources: ["*"],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        // GetObject also signs the view URLs and backs the If-Match write of a claim.
        actions: ["s3:GetObject", "s3:PutObject"],
        resources: [
          cache.arnForObjects(`${AUDIO_PREFIX}*`),
          cache.arnForObjects(`${CLAIM_PREFIX}*`),
        ],
      }),
    );
    role.addToPolicy(
      // So that a missing key answers 404, not 403.
      new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [cache.bucketArn] }),
    );
    // #endregion role

    // #region function
    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: HANDLER_TIMEOUT,
      role,
      logGroup,
      environment: {
        SPEECH_BACKEND: "polly",
        SPEECH_BUCKET: cache.bucketName,
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

    const url = handler.addFunctionUrl({
      // Lambda checks a SigV4 signature before the function runs. With NONE,
      // anyone holding the URL could spend this account's money on speech.
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });
    // #endregion function

    new CfnOutput(this, "FunctionUrl", { value: url.url });
    new CfnOutput(this, "CacheBucketName", { value: cache.bucketName });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
