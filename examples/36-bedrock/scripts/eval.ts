// vp run bedrock:eval          node scripts/eval.ts
// vp run bedrock:eval:live     node scripts/eval.ts --live
//
// Runs the regression suite in fixtures/eval/cases.json. Without --live, each case gets the
// transcript it names: no AWS call, no charge. With --live, each case is one question to
// the real model, from this machine, with your credentials. BILLED: a few thousand tokens.
// Never part of check:all.

import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";

import suite from "../fixtures/eval/cases.json" with { type: "json" };
import { createBedrockGateway } from "../src/bedrock.ts";
import { parseEnv } from "../src/env.ts";
import { type EvalCase, evalSuiteSchema, runSuite } from "../src/eval.ts";
import type { ModelGateway } from "../src/gateway.ts";
import { seededNotes } from "../src/local-notes.ts";
import { createAssistant } from "../src/loop.ts";
import { profileOf } from "../src/models.ts";
import { createScriptedModel } from "../src/scripted-model.ts";
import { createNoteTools } from "../src/tools.ts";
import { transcriptNames, transcripts } from "../src/transcripts.ts";
import { addUsage, costMicroUsd, NO_USAGE } from "../src/usage.ts";

const { values } = parseArgs({ options: { live: { type: "boolean", default: false } } });

try {
  const env = parseEnv({
    ...process.env,
    AI_BACKEND: values.live ? "bedrock" : "scripted",
    BEDROCK_MODEL_ID: process.env["BEDROCK_MODEL_ID"] ?? "jp.amazon.nova-2-lite-v1:0",
  });
  const profile = profileOf(env.BEDROCK_MODEL_ID);
  const { cases } = v.parse(evalSuiteSchema, suite);

  let live: ModelGateway | undefined;
  if (values.live) {
    const { target } = await preflight({
      access: "mutate",
      action: `ask ${env.BEDROCK_MODEL_ID} ${cases.length} questions (billed)`,
    });
    live = createBedrockGateway(target.region);
  }
  const gatewayFor = (testCase: EvalCase): ModelGateway => {
    if (live !== undefined) {
      return live;
    }
    const name = v.parse(v.picklist(transcriptNames), testCase.transcript);
    return createScriptedModel(transcripts[name]);
  };

  // The same notes either way: the questions are about them.
  const tools = createNoteTools(await seededNotes(), "local-alice");
  const result = await runSuite(cases, (testCase) =>
    createAssistant({
      gateway: gatewayFor(testCase),
      request: {
        modelId: env.BEDROCK_MODEL_ID,
        profile,
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
    })(testCase.question, tools, new AbortController().signal),
  );

  let usage = NO_USAGE;
  for (const one of result.results) {
    usage = one.usage === null ? usage : addUsage(usage, one.usage);
    console.log(`${one.problems.length === 0 ? "ok  " : "FAIL"} ${one.id}`);
    for (const problem of one.problems) {
      console.log(`       ${problem}`);
    }
  }
  console.log(`${result.passed} passed, ${result.failed} failed`);
  console.log(
    `model: ${values.live ? env.BEDROCK_MODEL_ID : "scripted (no model was called)"}; ` +
      `tokens in/out ${usage.inputTokens}/${usage.outputTokens}; ` +
      `list price about USD ${(costMicroUsd(usage, profile.usdPerMillionTokens) / 1e6).toFixed(6)}`,
  );
  process.exit(result.failed === 0 ? 0 : 1);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
