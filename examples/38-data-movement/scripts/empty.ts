// vp run move:empty          counts what is in the two buckets (reads AWS)
// vp run move:empty --yes    deletes every version in both (changes AWS)
//
// cdkd 0.296.28 will not delete a non-empty bucket, so this runs before the
// two destroy tasks. The archive is versioned: every version and delete marker goes.

import { parseArgs } from "node:util";

import { S3Client } from "@aws-sdk/client-s3";

import { S3VersionedBucket } from "@aih/example-22-recovery/src/s3-versioned-bucket.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { ARCHIVE_REGION, SOURCE_REGION } from "../infra/lib/regions.ts";

const BUCKETS = [
  { stack: "AihDataMovement", output: "UploadsBucketName", region: SOURCE_REGION },
  { stack: "AihDataMovementArchive", output: "ArchiveBucketName", region: ARCHIVE_REGION },
];
const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } } });

try {
  await preflight({
    access: values.yes ? "mutate" : "observe",
    action: "delete every object version in the uploads bucket and in the archive",
  });
  // #region empty
  for (const { stack, output, region } of BUCKETS) {
    // Each stack's state is read in the stack's own Region, where it was bootstrapped.
    const name = requireOutput(await readStackOutputs(process.cwd(), stack, region), output);
    const bucket = new S3VersionedBucket(new S3Client({ region }), name);
    let count = 0;
    for await (const version of bucket.listVersions("")) {
      count++;
      if (values.yes) {
        await bucket.removeVersion(version.key, version.versionId);
      }
    }
    console.log(`${name} (${region}): ${values.yes ? "deleted" : "found"} ${count} versions`);
  }
  // #endregion empty
  if (!values.yes) {
    console.log("Nothing was deleted. Pass --yes to delete them; none can be brought back.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
