// vp run celld:plan [key=value ...]
//
// Prints the fleet a deploy with these settings would create, what celld's
// documentation says about a fleet of that size, and what it costs while idle.
// Reads only this checkout: no AWS, no credentials.
//
// Settings: nodes, instanceType, dataVolumeGiB, stateOnDestroy, dataSnapshots, amiId.
import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";
import { parseFleetConfig } from "../src/config.ts";
import { allFixedItems, type FleetState, MONTH_HOURS } from "../src/cost.ts";
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
  const config = parseFleetConfig(settings);
  const { lines, missing } = describePlan(config);
  console.log(lines.join("\n"));
  if (missing.length > 0) {
    console.log(`\nThe nodes would start, but could not reach ${missing.join(", ")}.`);
  }

  const { prices, allowances } = loadPricing();
  const cost = (state: FleetState, hours: number): string =>
    calculate(
      {
        id: "celld-plan",
        chapter: "24",
        title: { ja: "", en: "" },
        assumptions: { ja: [], en: [] },
        items: allFixedItems(config, state, hours),
      },
      prices.prices,
      allowances,
    ).listUsd.toFixed(2);
  if (config.nodes === 0) {
    console.log("\nNothing billed by the hour. Objects in the two buckets are billed by size and by request.");
  } else {
    console.log("\nFixed cost, list price, fleet and network endpoints together (USD):");
    for (const state of ["running", "stopped"] as const) {
      console.log(
        `  ${state.padEnd(9)} ${cost(state, 24).padStart(7)} a day   ${cost(state, MONTH_HOURS).padStart(7)} for ${MONTH_HOURS} hours`,
      );
    }
    console.log(
      "S3 requests are estimated from celld's documented intervals. Storage, data transfer, and snapshots are not included.",
    );
  }
  process.exit(missing.length > 0 ? 2 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
