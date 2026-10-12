// vp run ai:test:live
//   node scripts/live.ts
//
// Runs the same summarizer as the API against the real model, from this
// machine, with your own credentials. BILLED: one short summary. Never part of
// check:all. It checks what fixtures cannot: that the model ID resolves, that
// your account may call it, and that the real events fit the schema.

import { setTimeout as sleep } from "node:timers/promises";

import { preflight } from "@aih/tools/aws/preflight.ts";

import { createBedrockGateway } from "../src/bedrock.ts";
import { collectSummary } from "../src/client.ts";
import { parseEnv } from "../src/env.ts";
import { createSummarizer } from "../src/summarize.ts";

const NOTE = {
  title: "リリース前の確認",
  body: "金曜のリリースまでに、決済の結合テストと負荷試験を終える。担当は佐藤さんと鈴木さん。水曜の朝会で進み具合を確認する。",
};

try {
  const env = parseEnv({ ...process.env, AI_BACKEND: "bedrock" });
  const { target } = await preflight({
    access: "mutate",
    action: `summarize one note with ${env.BEDROCK_MODEL_ID} (billed)`,
  });

  const summarize = createSummarizer({
    gateway: createBedrockGateway(target.region),
    modelId: env.BEDROCK_MODEL_ID,
    maxOutputTokens: env.MAX_OUTPUT_TOKENS,
    timeoutMs: env.INFERENCE_TIMEOUT_MS,
    retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 },
    sleep: (ms) => sleep(ms).then(() => undefined),
    random: Math.random,
    timeoutSignal: (ms) => AbortSignal.timeout(ms),
  });

  const start = await summarize(NOTE, new AbortController().signal);
  if (!start.ok) {
    throw new Error(`could not start: ${start.failure.code} after ${start.attempts} attempt(s)`);
  }
  let deltas = 0;
  const result = await collectSummary(start.events, (text) => {
    deltas += 1;
    process.stdout.write(text);
  });
  process.stdout.write("\n");

  if (result.status !== "complete") {
    throw new Error(`the summary did not complete: ${result.reason}`);
  }
  if (deltas < 1 || result.text.trim() === "") {
    throw new Error("the model finished without sending any text");
  }
  if (result.usage === null) {
    throw new Error("the stream ended without a metadata event, so the billed tokens are unknown");
  }
  console.log(
    `ok   ${deltas} delta(s), tokens in/out: ${result.usage.inputTokens}/${result.usage.outputTokens}`,
  );
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error("FAIL", error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
}
