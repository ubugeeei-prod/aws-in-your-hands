// vp run async:empty          counts the uploaded images (reads AWS)
// vp run async:empty --yes    deletes every one of them (changes AWS)
//   node scripts/empty-uploads.ts [--yes]
//
// cdkd 0.296.28 will not delete a non-empty bucket, so this empties the
// uploads bucket before `async:infra:destroy`. Each delete is an event, and
// the worker, if it is still deployed, drops its records as they arrive.
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { listRemote, remove } from "@aih/tools/site/bucket.ts";
import { S3Client } from "@aws-sdk/client-s3";

const STACK = "AihAsync";
const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } } });

try {
  const { target } = await preflight({
    access: values.yes ? "mutate" : "observe",
    action: "delete every uploaded image",
    stack: STACK,
  });
  const bucket = requireOutput(await readStackOutputs(process.cwd(), STACK, target.region), "UploadsBucketName");
  const s3 = new S3Client({ region: target.region });
  const keys = (await listRemote(s3, bucket)).map((object) => object.key);
  console.log(`bucket: ${bucket}, objects: ${keys.length}`);
  if (!values.yes) {
    console.log("Nothing was deleted. Pass --yes to delete these objects; attached images stop loading.");
    process.exit(0);
  }
  await remove(s3, bucket, keys);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
