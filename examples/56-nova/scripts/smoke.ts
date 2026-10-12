// vp run nova:smoke
//   node scripts/smoke.ts [--image photo.jpg]
//
// Against the deployed stack: an unsigned call must be refused; then one image is uploaded
// under the caller's own prefix, described, read back, and removed. BILLED: one description.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import * as v from "valibot";

import { objectKey } from "@aih/example-07-uploads/api/src/keys.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { descriptionViewSchema, inProgressSchema, meSchema } from "../src/contract.ts";
import { SAMPLE_PNG } from "../src/fixtures.ts";
import { signedFetch } from "./sign.ts";

const STACK = "AihNova";
const { values } = parseArgs({ options: { image: { type: "string" } } });

try {
  const { target } = await preflight({
    access: "mutate",
    action: "upload one image and describe it through the deployed function URL (billed)",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const base = requireOutput(outputs, "FunctionUrl");
  const bucket = requireOutput(outputs, "MediaBucketName");
  const call = (method: string, path: string) =>
    signedFetch(new URL(path, base), target.region, method);

  const unsigned = await fetch(new URL("/me", base));
  await unsigned.body?.cancel();
  if (unsigned.status !== 403) {
    throw new Error(
      `an unsigned request answered ${unsigned.status}, expected 403. Is the URL public?`,
    );
  }
  console.log("ok   an unsigned request is refused (403)");

  // The function says which prefix is ours. It derives it from the signature, not from us.
  const { owner } = v.parse(meSchema, await (await call("GET", "/me")).json());
  const parts = { owner, noteId: "smoke", attachmentId: randomUUID() };
  const key = objectKey(parts);
  const s3 = new S3Client({ region: target.region });
  const png = values.image === undefined;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: png ? SAMPLE_PNG : readFileSync(values.image ?? ""),
      ContentType: png || values.image?.endsWith(".png") ? "image/png" : "image/jpeg",
    }),
  );
  console.log(`ok   uploaded s3://${bucket}/${key}`);

  const path = `/notes/${parts.noteId}/attachments/${parts.attachmentId}/description`;
  try {
    let response = await call("PUT", path);
    // 202: another request holds the claim. Nothing else should, here, but the loop is the protocol.
    for (let attempt = 0; response.status === 202 && attempt < 10; attempt += 1) {
      const { retryAfterSeconds } = v.parse(inProgressSchema, await response.json());
      await sleep(Math.min(retryAfterSeconds, 5) * 1000);
      response = await call("GET", path);
    }
    if (response.status !== 200) {
      throw new Error(`describing answered ${response.status}: ${await response.text()}`);
    }
    const first = v.parse(descriptionViewSchema, await response.json());
    console.log(`ok   ${first.outcome} by ${first.modelId}: ${first.text ?? "(no text)"}`);

    const again = v.parse(descriptionViewSchema, await (await call("PUT", path)).json());
    if (!again.reused || again.createdAt !== first.createdAt) {
      throw new Error("the second PUT did not reuse the stored description");
    }
    console.log("ok   a second PUT reused the stored description");
  } finally {
    await call("DELETE", path);
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.log("ok   removed the description and the upload");
  }
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
