import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import type { Construct } from "constructs";

// Fixed, so the role can name the log groups before the function exists.
const FUNCTION_NAME = "aih-edge-body-digest";

export class BodyDigestStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    if (this.region !== "us-east-1") {
      throw new Error("Lambda@Edge functions must be created in us-east-1");
    }

    // #region role
    // Both principals: Lambda runs the function, and the edge service runs its replicas.
    const role = new iam.Role(this, "BodyDigestRole", {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal("lambda.amazonaws.com"),
        new iam.ServicePrincipal("edgelambda.amazonaws.com"),
      ),
    });
    // A replica logs in the Region where it ran, to a group named after us-east-1.
    // The Region is the one wildcard: nobody knows in advance where readers are.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [
          `arn:aws:logs:*:${this.account}:log-group:/aws/lambda/us-east-1.${FUNCTION_NAME}`,
          `arn:aws:logs:*:${this.account}:log-group:/aws/lambda/us-east-1.${FUNCTION_NAME}:*`,
        ],
      }),
    );
    // #endregion role

    // #region function
    const bodyDigest = new nodejs.NodejsFunction(this, "BodyDigest", {
      functionName: FUNCTION_NAME,
      entry: fileURLToPath(new URL("../../src/lambda-edge/body-digest.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      // Lambda@Edge does not run arm64.
      architecture: lambda.Architecture.X86_64,
      memorySize: 128,
      timeout: Duration.seconds(5),
      role,
      // Lambda@Edge refuses environment variables, and this option would add one.
      awsSdkConnectionReuse: false,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
      },
    });
    // #endregion function

    // #region version
    // CloudFront takes a numbered version. CDK publishes a new one whenever the code or configuration changes.
    new CfnOutput(this, "BodyDigestVersionArn", { value: bodyDigest.currentVersion.functionArn });
    // #endregion version
  }
}
