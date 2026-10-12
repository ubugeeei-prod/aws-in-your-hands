import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { type Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createLogger } from "@aih/example-04-http-api/src/log.ts";
import type { Authenticate } from "@aih/example-06-auth/api/src/identity.ts";
import type { ModelGateway } from "@aih/example-36-bedrock/src/gateway.ts";
import { profileOf } from "@aih/example-36-bedrock/src/models.ts";
import type { NoteReader } from "@aih/example-36-bedrock/src/tools.ts";

import { createAgent } from "./agent.ts";
import type { Env } from "./env.ts";
import type { MemoryStore } from "./memory-store.ts";

export type Parts = {
  gateway: ModelGateway;
  authenticate: Authenticate;
  notes: NoteReader;
  store: MemoryStore;
};

// #region compose
/** The one place that touches the real clock, real randomness, and real timers. */
export function composeAgent(env: Env, parts: Parts): Fetch {
  return createAgent({
    authenticate: parts.authenticate,
    notes: parts.notes,
    store: parts.store,
    log: createLogger(env.LOG_LEVEL),
    newRequestId: randomUUID,
    // Everything below is chapter 36's loop, with the limits it had there.
    assistant: {
      gateway: parts.gateway,
      request: {
        modelId: env.BEDROCK_MODEL_ID,
        profile: profileOf(env.BEDROCK_MODEL_ID),
        maxOutputTokens: env.MAX_OUTPUT_TOKENS,
        promptCache: false,
      },
      limits: {
        maxTurns: env.MAX_TURNS,
        maxToolCallsPerTurn: 4,
        maxToolErrors: 2,
        maxTotalTokens: env.MAX_TOTAL_TOKENS,
      },
      retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 },
      timeoutMs: env.INFERENCE_TIMEOUT_MS,
      sleep: (ms) => sleep(ms).then(() => undefined),
      random: Math.random,
      timeoutSignal: (ms) => AbortSignal.timeout(ms),
    },
  });
}
// #endregion compose
