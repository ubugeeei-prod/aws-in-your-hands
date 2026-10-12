// vp run fwm:cost
// Local only: reads data/pricing and prints the month this chapter's two policies would cost.

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { monthlyItems, NOT_IN_THE_SUM, SMALL_ORGANIZATION } from "../src/cost.ts";

const { prices, allowances } = loadPricing();
const result = calculate(
  {
    id: "fwm-small-org (computed)",
    chapter: "42",
    title: { ja: "", en: "" },
    assumptions: { ja: [], en: [] },
    items: monthlyItems(SMALL_ORGANIZATION),
  },
  prices.prices,
  allowances,
);

for (const line of result.lines) {
  console.log(`${line.listUsd.toFixed(2).padStart(8)}  ${line.priceId}  (${line.basis})`);
}
console.log(`${result.listUsd.toFixed(2).padStart(8)}  USD a month at list price`);
console.log("\nNot in the sum:");
for (const item of NOT_IN_THE_SUM) {
  console.log(`  - ${item}`);
}
