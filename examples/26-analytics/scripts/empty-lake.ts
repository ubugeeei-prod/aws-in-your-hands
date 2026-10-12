// vp run analytics:empty          counts the objects in the lake bucket (reads AWS)
// vp run analytics:empty --yes    deletes every one of them (changes AWS)
//   node scripts/empty-lake.ts [--yes]
//
// cdkd 0.296.28 will not delete a non-empty bucket, so this empties the lake
// bucket before `analytics:infra:destroy`: the records, the failed records, and
// the query results.

import { parseArgs } from "node:util";

import { S3Client } from "@aws-sdk/client-s3";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { listRemote, remove } from "@aih/tools/site/bucket.ts";

const STACK = "AihAnalytics";
const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } } });

try {
  const { target } = await preflight({
    access: values.yes ? "mutate" : "observe",
    action: "delete every record and query result in the lake bucket",
    stack: STACK,
  });
  const bucket = requireOutput(
    await readStackOutputs(process.cwd(), STACK, target.region),
    "LakeBucketName",
  );
  const s3 = new S3Client({ region: target.region });
  const keys = (await listRemote(s3, bucket)).map((object) => object.key);
  console.log(`bucket: ${bucket}, objects: ${keys.length}`);
  if (!values.yes) {
    console.log(
      "Nothing was deleted. Pass --yes to delete these objects; the records are gone for good.",
    );
    process.exit(0);
  }
  await remove(s3, bucket, keys);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
