// vp run ssr:assets:plan / ssr:assets:publish
//   node scripts/publish-assets.ts [--dry-run] [--retention-days N]
//
// Copies .output/public/_nuxt into the stack's bucket. Run it before
// deploying the function, so new HTML never points at files that are not there yet.

import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { S3Client } from "@aws-sdk/client-s3";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { listLocal, listRemote, remove, upload } from "@aih/tools/site/bucket.ts";

import { describeAssetPlan, planAssets } from "./asset-plan.ts";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "retention-days": { type: "string", default: "7" },
  },
});
const retentionDays = Number(values["retention-days"]);
if (!Number.isInteger(retentionDays) || retentionDays < 0) {
  console.error("--retention-days must be a non-negative integer");
  process.exit(64);
}

try {
  const dryRun = values["dry-run"];
  const { target } = await preflight({
    access: dryRun ? "observe" : "mutate",
    action: "publish SSR static assets",
    stack: "AihSsr",
  });
  const bucket = requireOutput(
    await readStackOutputs(process.cwd(), "AihSsr", target.region),
    "ContentBucketName",
  );
  const directory = resolve(".output/public");
  const s3 = new S3Client({ region: target.region });

  const plan = planAssets({
    local: listLocal(directory),
    remote: await listRemote(s3, bucket),
    now: new Date(),
    retentionDays,
  });
  console.log(`bucket: ${bucket}\n${describeAssetPlan(plan)}`);
  if (dryRun) {
    console.log("dry run: nothing was changed.");
    process.exit(0);
  }

  await upload(s3, bucket, directory, plan.upload);
  await upload(s3, bucket, directory, plan.uploadLast);
  await remove(s3, bucket, plan.remove);
  console.log("assets published. Deploy the function next: vp run ssr:infra:deploy");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(
    "The publish did not finish. It is safe to run it again: files already uploaded are skipped.",
  );
  process.exit(1);
}
