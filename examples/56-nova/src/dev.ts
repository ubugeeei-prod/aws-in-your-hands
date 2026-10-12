import { setTimeout as sleep } from "node:timers/promises";

import { S3Client } from "@aws-sdk/client-s3";
import * as v from "valibot";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { createBedrockGateway } from "./bedrock.ts";
import { composeApp } from "./compose.ts";
import { parseEnv } from "./env.ts";
import { SAMPLE_PNG, scriptNames, scripts } from "./fixtures.ts";
import { type Media, mediaKeys } from "./media.ts";
import { MemoryMedia } from "./memory-media.ts";
import type { ModelGateway } from "./model.ts";
import { S3Media } from "./s3-media.ts";
import { createScriptedModel } from "./scripted-model.ts";

// #region dev
const env = parseEnv(process.env);
const port = Number(process.env["PORT"] ?? 8856);
// Nobody signs in here. Every request is this one owner.
const OWNER = "local";

let media: Media;
let model: ModelGateway;
if (env.NOVA_BACKEND === "bedrock" && env.MEDIA_BUCKET !== undefined) {
  // This server runs here. The model does not: every new description is a billed call.
  media = new S3Media(new S3Client({ region: env.AWS_REGION }), env.MEDIA_BUCKET);
  model = createBedrockGateway(env.AWS_REGION);
  console.log(`inference: REMOTE and BILLED. ${env.DESCRIBE_MODEL_ID}, s3://${env.MEDIA_BUCKET}`);
} else {
  const name = v.parse(
    v.optional(v.picklist(scriptNames), "described"),
    process.env["NOVA_SCRIPT"],
  );
  const memory = new MemoryMedia();
  const sample = { owner: OWNER, noteId: "note-1", attachmentId: "image-1" };
  memory.seed(mediaKeys(sample).source, SAMPLE_PNG, "image/png");
  media = memory;
  // Three seconds per answer, so that a second request has time to meet the first.
  model = createScriptedModel(scripts[name], (abort) =>
    sleep(3000, undefined, { signal: abort }).then(
      () => undefined,
      () => undefined,
    ),
  );
  console.log(`inference: none. Playing fixtures/converse/${name}.json. No AWS call, no charge`);
  console.log(`one upload is in place: /notes/${sample.noteId}/attachments/${sample.attachmentId}`);
}

// Loopback only: with NOVA_BACKEND=bedrock, anyone who can reach this port spends your money.
nodeServer(composeApp(env, { media, model, ownerOf: () => OWNER })).listen(
  port,
  "127.0.0.1",
  () => {
    console.log(`description API on http://localhost:${port}`);
  },
);
// #endregion dev
