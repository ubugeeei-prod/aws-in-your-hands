import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createLogger } from "@aih/example-04-http-api/src/log.ts";

import { createApp } from "./app.ts";
import type { Env } from "./env.ts";
import { createSummarizer, type ModelGateway } from "./summarize.ts";

// #region compose
/** The one place that touches the real clock, real randomness, and real timers. */
export function composeApp(env: Env, gateway: ModelGateway): Fetch {
  return createApp({
    env,
    log: createLogger(env.LOG_LEVEL),
    summarize: createSummarizer({
      gateway,
      modelId: env.BEDROCK_MODEL_ID,
      maxOutputTokens: env.MAX_OUTPUT_TOKENS,
      // One deadline for every attempt together, not one per attempt.
      timeoutMs: env.INFERENCE_TIMEOUT_MS,
      retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 },
      sleep: (ms) => sleep(ms).then(() => undefined),
      random: Math.random,
      timeoutSignal: (ms) => AbortSignal.timeout(ms),
    }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
// #endregion compose
