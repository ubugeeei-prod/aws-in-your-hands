// vp run glue:verify    compares what the job wrote with the specification (reads AWS)
//   node scripts/verify.ts
//
// For the sample days: downloads the Parquet files under the curated prefix and
// compares their rows with src/curate.ts applied to the same sample. This is the
// check that glue/curate.py does what the specification says.

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { listRemote } from "@aih/tools/site/bucket.ts";

import { difference, identical } from "../src/compare.ts";
import { curate } from "../src/curate.ts";
import { curatedPrefix } from "../src/layout.ts";
import { readCurated } from "../src/parquet.ts";
import { SAMPLE_DAYS, sampleLake } from "../src/sample.ts";

const STACK = "AihGlue";

try {
  const { target } = await preflight({
    access: "observe",
    action: "read the curated files of the sample days",
    stack: STACK,
  });
  const bucket = requireOutput(
    await readStackOutputs(process.cwd(), STACK, target.region),
    "LakeBucketName",
  );
  const s3 = new S3Client({ region: target.region });
  const keys = (await listRemote(s3, bucket)).map((object) => object.key);
  const { records } = sampleLake();
  let same = true;

  for (const day of SAMPLE_DAYS) {
    const files = keys.filter(
      (key) => key.startsWith(curatedPrefix(day)) && key.endsWith(".parquet"),
    );
    const written = [];
    for (const key of files) {
      const body = await (
        await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      ).Body?.transformToByteArray();
      if (body === undefined) {
        throw new Error(`s3://${bucket}/${key} has no body`);
      }
      written.push(...(await readCurated(new Uint8Array(body).buffer)));
    }
    const found = difference(curate(records, day), written);
    same &&= identical(found);
    console.log(
      `${day}: ${String(files.length)} file(s), ${String(written.length)} rows; ${
        identical(found)
          ? "identical to the specification"
          : `missing ${String(found.missing.length)}, unexpected ${String(found.unexpected.length)}, doubled ${String(found.doubled.length)}, changed ${String(found.changed.length)}`
      }`,
    );
  }
  process.exit(same ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
