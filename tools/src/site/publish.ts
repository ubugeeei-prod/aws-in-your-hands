// vp run book:publish / spa:publish
//   node tools/src/site/publish.ts <appDir> <stack> <buildDir> [--dry-run] [--force] [--asset-retention-days N]
//
// Copies an already built site into the bucket that cdkd created. It never
// creates or reconfigures the bucket or the distribution: that is the infra
// task's job, and keeping the two apart keeps cdkd the only resource manager.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { S3Client } from "@aws-sdk/client-s3";
import { preflight } from "../aws/preflight.ts";
import { readStackOutputs, requireOutput } from "../infra/outputs.ts";
import { listLocal, listRemote, remove, upload } from "./bucket.ts";
import { contentTypeFor, describePlan, planPublish, REVALIDATE } from "./plan.ts";
import { REVISION_KEY, sourceRevision } from "./revision.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "asset-retention-days": { type: "string", default: "30" },
  },
});
const [appDir, stack, buildDir] = positionals;
if (appDir === undefined || stack === undefined || buildDir === undefined) {
  console.error("usage: publish.ts <appDir> <stack> <buildDir> [--dry-run] [--force] [--asset-retention-days N]");
  process.exit(64);
}
const assetRetentionDays = Number(values["asset-retention-days"]);
if (!Number.isInteger(assetRetentionDays) || assetRetentionDays < 0) {
  console.error("--asset-retention-days must be a non-negative integer");
  process.exit(64);
}

try {
  const dryRun = values["dry-run"];
  const { target } = await preflight({ access: dryRun ? "observe" : "mutate", action: "publish site content", stack });
  const outputs = await readStackOutputs(resolve(appDir), stack, target.region);
  const bucket = requireOutput(outputs, "ContentBucketName");
  const directory = resolve(buildDir);
  const s3 = new S3Client({ region: target.region });

  const local = listLocal(directory).filter((file) => file.key !== REVISION_KEY);
  const plan = planPublish({
    local,
    remote: (await listRemote(s3, bucket)).filter((object) => object.key !== REVISION_KEY),
    now: new Date(),
    assetRetentionDays,
    force: values.force,
  });
  console.log(`bucket: ${bucket}\n${describePlan(plan)}`);
  if (dryRun) {
    console.log("dry run: nothing was changed.");
    process.exit(0);
  }

  // The order is what keeps a half-finished publish harmless. If this process
  // dies after phase 1, the bucket holds extra files that nothing links to.
  // If it dies during phase 2, every page that was already replaced finds its
  // assets, and the pages not yet replaced still find the old ones.
  await upload(s3, bucket, directory, plan.uploadAssets);
  await upload(s3, bucket, directory, plan.uploadPages);
  await remove(s3, bucket, plan.deletePages);
  await remove(s3, bucket, plan.deleteAssets);

  // Written last: its presence at a revision means the phases above finished.
  const revision = sourceRevision(directory);
  const staging = mkdtempSync(join(tmpdir(), "aih-publish-"));
  writeFileSync(
    join(staging, REVISION_KEY),
    `${JSON.stringify({ revision, publishedAt: new Date().toISOString() })}\n`,
  );
  await upload(s3, bucket, staging, [
    { key: REVISION_KEY, contentType: contentTypeFor(REVISION_KEY), cacheControl: REVALIDATE },
  ]);
  console.log(`published revision ${revision}. Run the smoke task to confirm what readers receive.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("The publish did not finish. It is safe to run it again: files already uploaded are skipped.");
  process.exit(1);
}
