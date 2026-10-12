import { randomUUID } from "node:crypto";

import type { Handler } from "@aih/example-04-http-api/src/http/router.ts";
import { createLogger } from "@aih/example-04-http-api/src/log.ts";

import { createApp } from "./app.ts";
import type { Env } from "./env.ts";
import type { Media } from "./media.ts";
import type { ModelGateway } from "./model.ts";

// #region compose
/** The one place that touches the real clock, real randomness, and real timers. */
export function composeApp<Context>(
  env: Env,
  parts: { media: Media; model: ModelGateway; ownerOf: (context: Context) => string | undefined },
): Handler<Context> {
  const bucket = env.MEDIA_BUCKET ?? "local";
  return createApp({
    describe: {
      media: parts.media,
      model: parts.model,
      modelId: env.DESCRIBE_MODEL_ID,
      maxOutputTokens: env.MAX_OUTPUT_TOKENS,
      language: env.DESCRIPTION_LANGUAGE,
      leaseMs: env.LEASE_SECONDS * 1000,
      timeoutMs: env.INFERENCE_TIMEOUT_MS,
      locate: (key) => ({
        uri: `s3://${bucket}/${key}`,
        ...(env.MEDIA_BUCKET_OWNER === undefined ? {} : { bucketOwner: env.MEDIA_BUCKET_OWNER }),
      }),
      now: () => new Date(),
      newClaimId: randomUUID,
      timeoutSignal: (ms) => AbortSignal.timeout(ms),
    },
    ownerOf: parts.ownerOf,
    stage: env.STAGE,
    backend: env.NOVA_BACKEND,
    log: createLogger(env.LOG_LEVEL),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
// #endregion compose
