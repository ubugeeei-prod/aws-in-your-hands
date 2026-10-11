// vp run net:plan [key=value ...]
//
// Prints the subnets, routes, and fixed monthly cost of a layout. Reads only
// this checkout: no AWS, no credentials.
import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";
import { parseNetworkConfig } from "../src/config.ts";
import { fixedMonthlyItems, MONTH_HOURS } from "../src/cost.ts";
import { planNetwork } from "../src/plan.ts";
import { describePlan } from "../src/report.ts";

const settings = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf("=");
    if (separator < 1) {
      throw new Error(`expected key=value, got "${argument}"`);
    }
    return [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);

try {
  const plan = planNetwork(parseNetworkConfig(settings));
  console.log(describePlan(plan).join("\n"));

  const { prices, allowances } = loadPricing();
  const fixed = calculate(
    {
      id: "net-plan",
      chapter: "11",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items: fixedMonthlyItems(plan),
    },
    prices.prices,
    allowances,
  );
  console.log(
    `\nFixed cost for a ${MONTH_HOURS}-hour month: USD ${fixed.listUsd.toFixed(2)} (list price; data processing and transfer not included)`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
