// The permissions DataSync's user guide lists for an S3 location, and the
// trust policy from its page on the confused deputy problem.

import { Aws } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as s3 from "aws-cdk-lib/aws-s3";

// #region actions
const BUCKET_ACTIONS = ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads"];

export const SOURCE_OBJECT_ACTIONS = [
  "s3:GetObject",
  "s3:GetObjectTagging",
  "s3:GetObjectVersion",
  "s3:GetObjectVersionTagging",
  "s3:ListMultipartUploadParts",
];

// No s3:DeleteObjectVersion: in a versioned bucket this role can add a delete
// marker, and cannot remove a version.
export const DESTINATION_OBJECT_ACTIONS = [
  "s3:AbortMultipartUpload",
  "s3:DeleteObject",
  "s3:GetObject",
  "s3:GetObjectTagging",
  "s3:GetObjectVersion",
  "s3:GetObjectVersionTagging",
  "s3:ListMultipartUploadParts",
  "s3:PutObject",
  "s3:PutObjectTagging",
];

// What the cross-account tutorial puts in the destination bucket's policy.
export const CROSS_ACCOUNT_ACTIONS = [
  ...BUCKET_ACTIONS,
  "s3:AbortMultipartUpload",
  "s3:DeleteObject",
  "s3:GetObject",
  "s3:ListMultipartUploadParts",
  "s3:PutObject",
  "s3:GetObjectTagging",
  "s3:PutObjectTagging",
];
// #endregion actions

// #region trust
/** DataSync may assume the role only for locations of this account in this Region. */
export function dataSyncPrincipal(region: string): iam.IPrincipal {
  return new iam.ServicePrincipal("datasync.amazonaws.com", {
    conditions: {
      StringEquals: { "aws:SourceAccount": Aws.ACCOUNT_ID },
      ArnLike: {
        "aws:SourceArn": `arn:${Aws.PARTITION}:datasync:${region}:${Aws.ACCOUNT_ID}:*`,
      },
    },
  });
}
// #endregion trust

// #region grants
export function allowReadingFrom(role: iam.Role, bucket: s3.IBucket): void {
  role.addToPolicy(
    new iam.PolicyStatement({ actions: BUCKET_ACTIONS, resources: [bucket.bucketArn] }),
  );
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: SOURCE_OBJECT_ACTIONS,
      resources: [bucket.arnForObjects("*")],
    }),
  );
}

export function allowWritingTo(role: iam.Role, bucket: s3.IBucket): void {
  // The bucket must belong to this account: a bucket of the same name elsewhere is refused.
  const conditions = { StringEquals: { "aws:ResourceAccount": Aws.ACCOUNT_ID } };
  role.addToPolicy(
    new iam.PolicyStatement({ actions: BUCKET_ACTIONS, resources: [bucket.bucketArn], conditions }),
  );
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: DESTINATION_OBJECT_ACTIONS,
      resources: [bucket.arnForObjects("*")],
      conditions,
    }),
  );
}
// #endregion grants
