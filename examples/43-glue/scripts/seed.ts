// vp run glue:seed    uploads the sample raw files to the stack's bucket (changes AWS)
//   node scripts/seed.ts
//
// The same files `vp run glue:spec` reads, so that the job's output can be
// compared with the specification's by `vp run glue:verify`.

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { sampleLake } from "../src/sample.ts";

const STACK = "AihGlue";

try {
  const { target } = await preflight({
    access: "mutate",
    action: "upload the sample raw files",
    stack: STACK,
  });
  const bucket = requireOutput(
    await readStackOutputs(process.cwd(), STACK, target.region),
    "LakeBucketName",
  );
  const s3 = new S3Client({ region: target.region });
  for (const object of sampleLake().objects) {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: object.key, Body: object.bytes }));
    console.log(`  put s3://${bucket}/${object.key}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
