// vp run nitro:prices [instanceType=m6g.large]
//
// Prints the arm64 and x86 unit prices the book's choices rest on, and what this
// chapter's stack costs while it sits idle. Reads data/pricing only: no AWS.

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { compareArchitectures } from "../src/arch.ts";
import { parseNitroConfig } from "../src/config.ts";
import { fixedItems, type InstanceState, MONTH_HOURS } from "../src/cost.ts";

const settings = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf("=");
    if (separator < 1) {
      throw new Error(`expected key=value, got "${argument}"`);
    }
    return [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);

const { prices, allowances } = loadPricing();
const usdOf = (priceId: string): string => {
  const usd = prices.prices.find((price) => price.id === priceId)?.tiers[0]?.usd;
  if (usd === undefined) {
    throw new Error(`no price "${priceId}" in data/pricing/unit-prices.json`);
  }
  return usd;
};

console.log("Unit prices in ap-northeast-1, USD, list price (arm64 / x86)");
for (const row of compareArchitectures(usdOf)) {
  console.log(
    `  ${row.what.padEnd(40)} ${row.arm64Usd} / ${row.x86Usd}  arm64 is ${row.savingPercent.toFixed(1)}% less`,
  );
}

try {
  const config = parseNitroConfig(settings);
  const cost = (state: InstanceState, hours: number): string =>
    calculate(
      {
        id: "nitro-prices",
        chapter: "68",
        title: { ja: "", en: "" },
        assumptions: { ja: [], en: [] },
        items: fixedItems(config, state, hours),
      },
      prices.prices,
      allowances,
    ).listUsd.toFixed(2);

  console.log(`\nThis chapter's stack with ${config.instanceType}, before one enclave runs`);
  console.log(`  running, one day      USD ${cost("running", 24)}`);
  console.log(`  running, ${MONTH_HOURS} hours    USD ${cost("running", MONTH_HOURS)}`);
  console.log(`  stopped, ${MONTH_HOURS} hours    USD ${cost("stopped", MONTH_HOURS)}`);
  console.log("  An enclave adds no line: it uses vCPUs and memory the instance already pays for.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
