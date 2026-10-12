import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { createLogger } from "@aih/example-04-http-api/src/log.ts";
import type { Authenticate } from "@aih/example-06-auth/api/src/identity.ts";

import { type App, createApp } from "./app.ts";
import type { UsageLedger } from "./budget.ts";
import type { Env } from "./env.ts";
import type { ModelGateway } from "./gateway.ts";
import { createAssistant } from "./loop.ts";
import { profileOf } from "./models.ts";
import type { RequestOptions } from "./prompt.ts";
import { createExtractor } from "./structured.ts";
import type { NoteReader } from "./tools.ts";

export type Parts = {
  gateway: ModelGateway;
  authenticate: Authenticate;
  notes: NoteReader;
  ledger: UsageLedger;
};

// #region compose
/** The one place that touches the real clock, real randomness, and real timers. */
export function composeApp(env: Env, parts: Parts): App {
  const profile = profileOf(env.BEDROCK_MODEL_ID);
  const request: RequestOptions = {
    modelId: env.BEDROCK_MODEL_ID,
    profile,
    maxOutputTokens: env.MAX_OUTPUT_TOKENS,
    guardrail:
      env.GUARDRAIL_ID === ""
        ? undefined
        : { id: env.GUARDRAIL_ID, version: env.GUARDRAIL_VERSION },
    promptCache: env.PROMPT_CACHE === "on",
  };
  const timeoutSignal = (ms: number) => AbortSignal.timeout(ms);
  return createApp({
    env,
    authenticate: parts.authenticate,
    notes: parts.notes,
    ledger: parts.ledger,
    prices: profile.usdPerMillionTokens,
    log: createLogger(env.LOG_LEVEL),
    assistant: createAssistant({
      gateway: parts.gateway,
      request,
      limits: {
        maxTurns: env.MAX_TURNS,
        maxToolCallsPerTurn: 4,
        maxToolErrors: 2,
        maxTotalTokens: env.MAX_TOTAL_TOKENS,
      },
      retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 },
      // One deadline for every turn and every attempt together.
      timeoutMs: env.INFERENCE_TIMEOUT_MS,
      sleep: (ms) => sleep(ms).then(() => undefined),
      random: Math.random,
      timeoutSignal,
    }),
    extract: createExtractor({
      gateway: parts.gateway,
      request,
      timeoutMs: env.INFERENCE_TIMEOUT_MS,
      timeoutSignal,
    }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
// #endregion compose
