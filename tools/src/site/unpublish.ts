// cdkd 0.296.28 will not delete a non-empty bucket, so this empties it first.

import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { S3Client } from "@aws-sdk/client-s3";

import { preflight } from "../aws/preflight.ts";
import { readStackOutputs, requireOutput } from "../infra/outputs.ts";
import { listRemote, remove } from "./bucket.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { yes: { type: "boolean", default: false } },
});
const [appDir, stack] = positionals;
if (appDir === undefined || stack === undefined) {
  console.error("usage: unpublish.ts <appDir> <stack> --yes");
  process.exit(64);
}

try {
  const { target } = await preflight({
    access: values.yes ? "mutate" : "observe",
    action: "delete all site content",
    stack,
  });
  const bucket = requireOutput(
    await readStackOutputs(resolve(appDir), stack, target.region),
    "ContentBucketName",
  );
  const s3 = new S3Client({ region: target.region });
  const keys = (await listRemote(s3, bucket)).map((object) => object.key);
  console.log(`bucket: ${bucket}, objects: ${keys.length}`);
  if (!values.yes) {
    console.log(
      "Nothing was deleted. Pass --yes to delete these objects; the site stops serving content.",
    );
    process.exit(0);
  }
  await remove(s3, bucket, keys);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
