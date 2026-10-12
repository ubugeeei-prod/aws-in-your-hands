import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as datasync from "aws-cdk-lib/aws-datasync";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { allowReadingFrom, dataSyncPrincipal } from "./datasync-access.ts";

export class SourceStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // The attachments bucket of chapter 07, without the parts a browser needs.
    const uploads = new s3.Bucket(this, "Uploads", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: "abort-incomplete-multipart-uploads",
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region source-location
    const role = new iam.Role(this, "SourceRole", { assumedBy: dataSyncPrincipal(this.region) });
    allowReadingFrom(role, uploads);

    // A location is a bucket plus the role DataSync uses to reach it. It runs nothing by itself.
    const location = new datasync.CfnLocationS3(this, "SourceLocation", {
      s3BucketArn: uploads.bucketArn,
      s3Config: { bucketAccessRoleArn: role.roleArn },
    });
    // DataSync tries the role when the location is created, so the policy has to be there first.
    location.node.addDependency(role);
    // #endregion source-location

    new CfnOutput(this, "UploadsBucketName", { value: uploads.bucketName });
    new CfnOutput(this, "SourceLocationArn", { value: location.attrLocationArn });
  }
}
