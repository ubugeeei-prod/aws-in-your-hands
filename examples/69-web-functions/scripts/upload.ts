// vp run webfn:upload
//   node scripts/upload.ts
//
// Builds the package and puts it in the code bucket. The bucket is versioned, so every upload
// to the same key is a new version, and the version ID printed here is what a revision is made from.

import { createHash } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { preflight } from "@aih/tools/aws/preflight.ts";

import { CODE_KEY, codeBucketName, STACK } from "../src/names.ts";
import { packageZip } from "./build.ts";

try {
  const archive = await packageZip();
  const { target, identity } = await preflight({
    access: "mutate",
    action: "upload the Web Function package",
    stack: STACK,
  });
  const bucket = codeBucketName(identity.accountId, target.region);
  const put = await new S3Client({ region: target.region }).send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: CODE_KEY,
      Body: archive,
      ContentType: "application/zip",
      // The owner of the bucket is checked, so a bucket of the same name elsewhere is refused.
      ExpectedBucketOwner: identity.accountId,
    }),
  );
  if (put.VersionId === undefined) {
    throw new Error(`s3://${bucket}/${CODE_KEY} came back without a version ID. Is versioning on?`);
  }
  console.log(`s3://${bucket}/${CODE_KEY}: ${(archive.length / 1024).toFixed(1)} KiB`);
  console.log(`sha256:  ${createHash("sha256").update(archive).digest("hex")}`);
  console.log(`version: ${put.VersionId}`);
  console.log(`next:    vp run webfn:cfn:deploy -c stable=${put.VersionId}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
