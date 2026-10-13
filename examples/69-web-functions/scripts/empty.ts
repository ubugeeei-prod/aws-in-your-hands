// vp run webfn:empty
//   node scripts/empty.ts [--yes]
//
// Counts every version of every object in the code bucket. Deletes them all only with --yes.
// A revision whose object version is gone fails for good, so this is the step before destroy.

import { parseArgs } from "node:util";

import { DeleteObjectsCommand, ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3";

import { preflight } from "@aih/tools/aws/preflight.ts";

import { codeBucketName, STACK } from "../src/names.ts";

const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } } });

try {
  const { target, identity } = await preflight({
    access: values.yes ? "mutate" : "observe",
    action: values.yes ? "delete every uploaded package" : "count the uploaded packages",
    stack: STACK,
  });
  const bucket = codeBucketName(identity.accountId, target.region);
  const s3 = new S3Client({ region: target.region });
  let count = 0;
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        ExpectedBucketOwner: identity.accountId,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );
    // A delete marker is a version too, and the bucket is not empty while one is left.
    const found = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].flatMap((version) =>
      version.Key === undefined || version.VersionId === undefined
        ? []
        : [{ Key: version.Key, VersionId: version.VersionId }],
    );
    count += found.length;
    if (values.yes && found.length > 0) {
      const deleted = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          ExpectedBucketOwner: identity.accountId,
          Delete: { Objects: found, Quiet: true },
        }),
      );
      if ((deleted.Errors ?? []).length > 0) {
        throw new Error(`could not delete: ${JSON.stringify(deleted.Errors)}`);
      }
    }
    keyMarker = page.IsTruncated === true ? page.NextKeyMarker : undefined;
    versionIdMarker = page.IsTruncated === true ? page.NextVersionIdMarker : undefined;
  } while (keyMarker !== undefined);

  console.log(
    values.yes
      ? `deleted ${count} object versions from s3://${bucket}`
      : `s3://${bucket} holds ${count} object versions. Run again with --yes to delete them.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
