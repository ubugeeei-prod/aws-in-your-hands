// vp run nova:hello -- photo.jpg
//   node scripts/hello.ts [image file]
//
// One Converse call from this machine with an image inside the request, using your own
// credentials. BILLED: one image and a few dozen tokens of DESCRIBE_MODEL_ID.

import { readFileSync } from "node:fs";
import { extname } from "node:path";

import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import * as v from "valibot";

import { converseResponseSchema } from "@aih/example-17-ai/src/converse-stream.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";

import { parseEnv } from "../src/env.ts";
import { SAMPLE_PNG } from "../src/fixtures.ts";
import { buildDescribeRequest } from "../src/image.ts";

const TYPE_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

try {
  const env = parseEnv({
    DESCRIBE_MODEL_ID: "jp.amazon.nova-2-lite-v1:0",
    ...process.env,
    NOVA_BACKEND: "scripted",
  });
  const path = process.argv[2];
  // Without a file: the 1 x 1 PNG the tests use. The answer is dull, and the call is still billed.
  const bytes = path === undefined ? SAMPLE_PNG : new Uint8Array(readFileSync(path));
  const contentType = path === undefined ? "image/png" : (TYPE_BY_EXTENSION[extname(path)] ?? "");

  // #region hello
  const built = buildDescribeRequest([{ contentType, size: bytes.byteLength, source: { bytes } }], {
    modelId: env.DESCRIBE_MODEL_ID,
    maxOutputTokens: env.MAX_OUTPUT_TOKENS,
    language: env.DESCRIPTION_LANGUAGE,
  });
  if (!built.ok) {
    throw new Error(`this image cannot be sent: ${built.reason}`);
  }
  const { target } = await preflight({
    access: "mutate",
    action: `describe one image with ${env.DESCRIBE_MODEL_ID} (billed)`,
  });
  const client = new BedrockRuntimeClient({ region: target.region });
  const response = await client.send(new ConverseCommand(built.request));
  // #endregion hello

  const result = v.parse(converseResponseSchema, response);
  console.log(result.output.message.content.map((block) => block.text ?? "").join(""));
  console.log(
    `stop: ${result.stopReason}, tokens in/out: ${result.usage.inputTokens}/${result.usage.outputTokens}`,
  );
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
}
