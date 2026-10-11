import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import type { HelloConfig } from "./config.ts";

export type HelloStackProps = StackProps & { config: HelloConfig };

// #region stack
export class HelloStack extends Stack {
  constructor(scope: Construct, id: string, props: HelloStackProps) {
    super(scope, id, props);

    const notes = new s3.Bucket(this, "Notes", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(props.config.noncurrentVersionDays) }],
      // prod keeps its data when the stack goes. The practice stage is disposable.
      removalPolicy: props.config.stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    new CfnOutput(this, "NotesBucketName", { value: notes.bucketName });
  }
}
// #endregion stack
