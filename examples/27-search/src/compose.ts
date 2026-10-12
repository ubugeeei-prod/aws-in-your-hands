import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createLogger } from "@aih/example-04-http-api/src/log.ts";
import type { NoteRepository } from "@aih/example-05-dynamodb/src/repository.ts";
import type { ModelGateway } from "@aih/example-17-ai/src/summarize.ts";

import { createAnswerer } from "./answer.ts";
import { createApp } from "./app.ts";
import type { Embedder } from "./embedder.ts";
import type { Env } from "./env.ts";
import { ownerFromTrustedHeader } from "./owner.ts";
import { createSearch } from "./search.ts";
import type { VectorIndex } from "./vector-index.ts";

export type Parts = {
  notes: Pick<NoteRepository, "list">;
  embedder: Embedder;
  index: VectorIndex;
  gateway: ModelGateway;
  modelId: string;
};

// #region compose
/** The same app over two sets of parts: Maps on a laptop, AWS services in Lambda. */
export function composeApp(env: Env, parts: Parts): Fetch {
  const search = createSearch(parts);
  return createApp({
    stage: env.STAGE,
    backend: env.SEARCH_BACKEND,
    ownerOf: ownerFromTrustedHeader,
    search,
    answer: createAnswerer({
      search,
      gateway: parts.gateway,
      modelId: parts.modelId,
      maxOutputTokens: env.MAX_OUTPUT_TOKENS,
      timeoutMs: env.INFERENCE_TIMEOUT_MS,
      retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 },
      sleep: (ms) => sleep(ms).then(() => undefined),
      random: Math.random,
      timeoutSignal: (ms) => AbortSignal.timeout(ms),
    }),
    log: createLogger(env.LOG_LEVEL),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
// #endregion compose
