// vp run tune:plan
//   node scripts/plan.ts [--memory 256] [--ms 50] [--requests 1000000] [--provisioned 1]
//
// Prints the timeout chain this chapter deploys with, what a month of invocations costs at
// each memory setting if the duration stayed the same, the duration at which each setting
// would cost what the current one does, and what provisioned concurrency costs unused.
// Reads only this checkout: no AWS, no credentials. The durations are yours to supply.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { reservable, requestRateLimit, UNRESERVED_MINIMUM } from "../src/concurrency.ts";
import { breakEvenMs, provisionedBreakEven } from "../src/cost-inputs.ts";
import { invocationItems, MEMORY_STEPS, type PlanItem, provisionedItems } from "../src/plan.ts";
import {
  ANSWER_MARGIN_MS,
  checkHttpChain,
  FUNCTION_TIMEOUT_SECONDS,
  HTTP_API_INTEGRATION_SECONDS,
  SDK,
} from "../src/timeouts.ts";

// A flag's value is text. "512" becomes 512; "big" becomes NaN, which v.number() refuses.
const number = (min: number, max: number) =>
  v.pipe(v.string(), v.transform(Number), v.number(), v.minValue(min), v.maxValue(max));
const argsSchema = v.object({
  memory: v.optional(v.pipe(number(128, 10_240), v.integer()), "256"),
  ms: v.optional(number(1, 900_000), "50"),
  requests: v.optional(v.pipe(number(1, 1e12), v.integer()), "1000000"),
  provisioned: v.optional(v.pipe(number(1, 900), v.integer()), "1"),
});

try {
  const { values } = parseArgs({
    options: {
      memory: { type: "string" },
      ms: { type: "string" },
      requests: { type: "string" },
      provisioned: { type: "string" },
    },
  });
  const args = v.parse(argsSchema, values);
  const { prices, allowances } = loadPricing();
  const usd = (items: PlanItem[]) =>
    calculate(
      {
        id: "tune-plan",
        chapter: "29",
        title: { ja: "", en: "" },
        assumptions: { ja: [], en: [] },
        items,
      },
      prices.prices,
      allowances,
    ).listUsd.toFixed(2);

  console.log("Timeouts");
  console.log(`  API Gateway waits      ${HTTP_API_INTEGRATION_SECONDS} s`);
  console.log(`  function timeout       ${FUNCTION_TIMEOUT_SECONDS} s`);
  console.log(`  handler's own deadline ${FUNCTION_TIMEOUT_SECONDS * 1000 - ANSWER_MARGIN_MS} ms`);
  console.log(
    `  one SDK attempt        ${SDK.connectionTimeoutMs} ms to connect + ${SDK.requestTimeoutMs} ms to answer, ${SDK.maxAttempts} attempts`,
  );
  const findings = checkHttpChain({
    callerSeconds: HTTP_API_INTEGRATION_SECONDS,
    functionSeconds: FUNCTION_TIMEOUT_SECONDS,
    answerMarginMs: ANSWER_MARGIN_MS,
    sdk: SDK,
  });
  console.log(
    findings.length === 0
      ? "  in order"
      : findings.map((finding) => `  ${finding.rule}: ${finding.message}`).join("\n"),
  );

  const current = { memoryMb: args.memory, billedMs: args.ms };
  console.log(
    `\nMemory, for ${args.requests} invocations a month (list price, USD, ap-northeast-1, arm64)`,
  );
  console.log(`  now: ${args.memory} MB and ${args.ms} ms billed per invocation`);
  console.log("      MB   if still that long   costs the same at");
  for (const memoryMb of MEMORY_STEPS) {
    const same = usd(invocationItems({ ...current, memoryMb, invocations: args.requests }));
    console.log(
      `  ${String(memoryMb).padStart(6)}   ${same.padStart(18)}   ${breakEvenMs(current, memoryMb).toFixed(1).padStart(14)} ms`,
    );
  }
  console.log(
    "  Whether the duration falls with more memory is measured in AWS, not computed here.",
  );

  const firstTier = (id: string) => {
    const tier = prices.prices.find((price) => price.id === id)?.tiers[0];
    if (tier === undefined) {
      throw new Error(`no price "${id}" in data/pricing/unit-prices.json`);
    }
    return Number(tier.usd);
  };
  const share = provisionedBreakEven({
    onDemand: firstTier("lambda.duration.arm"),
    provisionedIdle: firstTier("lambda.provisioned.arm"),
    provisionedDuration: firstTier("lambda.duration.provisioned.arm"),
  });
  console.log(`\nProvisioned concurrency of ${args.provisioned} at ${args.memory} MB`);
  console.log(
    `  ${usd(provisionedItems({ memoryMb: args.memory, concurrency: args.provisioned }))} a month before the first request. The free tier does not apply.`,
  );
  console.log(
    share > 1
      ? `  Cheaper than on-demand only if busy ${(share * 100).toFixed(0)}% of the time: never, at these prices.`
      : `  Cheaper than on-demand once busy ${(share * 100).toFixed(0)}% of the time.`,
  );

  console.log(
    "\nConcurrency (your account's values: aws lambda get-account-settings, or Service Quotas)",
  );
  console.log(
    `  at the default limit of 1000: up to ${reservable({ limit: 1000, alreadyReserved: 0 })} reservable (${UNRESERVED_MINIMUM} stay unreserved), ${requestRateLimit(1000)} requests a second at most`,
  );
  console.log(
    `  at a limit of ${UNRESERVED_MINIMUM} or less, as a new account may have: ${reservable({ limit: UNRESERVED_MINIMUM, alreadyReserved: 0 })} reservable`,
  );
  process.exit(findings.length === 0 ? 0 : 2);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
