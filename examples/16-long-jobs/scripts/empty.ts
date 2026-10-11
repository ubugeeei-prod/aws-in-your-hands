// vp run export:empty          counts the objects in the exports bucket (reads AWS)
// vp run export:empty --yes    deletes every one of them (changes AWS)
//   node scripts/empty.ts [--yes]
//
// cdkd 0.296.28 will not delete a non-empty bucket, so this empties the
// exports bucket before `export:infra:destroy`.
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { listRemote, remove } from "@aih/tools/site/bucket.ts";
import { S3Client } from "@aws-sdk/client-s3";

const STACK = "AihLongJobs";
const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } } });

try {
  const { target } = await preflight({
    access: values.yes ? "mutate" : "observe",
    action: "delete every export",
    stack: STACK,
  });
  const bucket = requireOutput(await readStackOutputs(process.cwd(), STACK, target.region), "ExportsBucketName");
  const s3 = new S3Client({ region: target.region });
  const keys = (await listRemote(s3, bucket)).map((object) => object.key);
  console.log(`bucket: ${bucket}, objects: ${keys.length}`);
  if (!values.yes) {
    console.log("Nothing was deleted. Pass --yes to delete these objects.");
    process.exit(0);
  }
  await remove(s3, bucket, keys);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
