// vp run lmi:plan [key=value ...]
//
// Prints what the stack would run, whether its instances could send logs through
// the chapter 11 network, what it costs before the first request, and the load
// above which that is cheaper than standard Lambda.
// Reads only this checkout: no AWS, no credentials.
//
// Settings: instanceType, minExecutionEnvironments, maxExecutionEnvironments, maxVCpuCount,
// instances (how many to price; 3 unless given), durationMs (for the break-even; 100 unless given).
// Network settings (the ones you deploy chapter 11 with): egress, interfaceEndpoints.

import { parseNetworkConfig } from "@aih/example-11-network/src/config.ts";
import { fixedMonthlyItems } from "@aih/example-11-network/src/cost.ts";
import { planNetwork } from "@aih/example-11-network/src/plan.ts";
import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { managedConfigSchema, parseManagedConfig } from "../src/config.ts";
import { DEFAULT_INSTANCES, type FixedItem, instanceCeiling, MONTH_HOURS } from "../src/cost.ts";
import { checkAccess, NETWORK_SETTINGS, unreachable } from "../src/network.ts";
import { computePrices } from "../src/prices.ts";
import { allFixedItems, breakEvenTable, describePlan } from "../src/report.ts";

const settings = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf("=");
    if (separator < 1) {
      throw new Error(`expected key=value, got "${argument}"`);
    }
    return [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);
const { instances: instancesGiven, durationMs: durationGiven, ...rest } = settings;
const stackKeys = new Set(Object.keys(managedConfigSchema.entries));
const pick = (mine: boolean) =>
  Object.fromEntries(Object.entries(rest).filter(([key]) => stackKeys.has(key) === mine));
const wholeNumber = (name: string, value: string | undefined, fallback: number): number => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a whole number, got "${value}"`);
  }
  return parsed;
};

try {
  const config = parseManagedConfig(pick(true));
  const given = pick(false);
  const networkSettings = Object.keys(given).length > 0 ? given : NETWORK_SETTINGS;
  const network = planNetwork(parseNetworkConfig(networkSettings));
  const instances = wholeNumber(
    "instances",
    instancesGiven,
    config.maxExecutionEnvironments === 0 ? 0 : DEFAULT_INSTANCES,
  );
  const durationMs = wholeNumber("durationMs", durationGiven, 100);

  const flags = Object.entries(networkSettings).map(([key, value]) => ` -c ${key}=${value}`);
  console.log(`Network   vp run net:infra:deploy${flags.join("")}`);
  console.log(describePlan(config, network).join("\n"));
  const missing = unreachable(checkAccess(network));
  if (missing.length > 0) {
    console.log(
      `\nThe function would run, but its instances would have no path to: ${missing.join(", ")}.`,
    );
  }

  const { prices, allowances } = loadPricing();
  const usd = (items: FixedItem[]): number =>
    calculate(
      {
        id: "lmi-plan",
        chapter: "35",
        title: { ja: "", en: "" },
        assumptions: { ja: [], en: [] },
        items,
      },
      prices.prices,
      allowances,
    ).listUsd;
  const total = (count: number, hours: number): string =>
    usd(allFixedItems(config, network, count, hours))
      .toFixed(2)
      .padStart(7);
  const ceiling = instanceCeiling(config.maxVCpuCount);
  console.log(
    `\nFixed cost before the first request, list price, fleet and network together (USD):`,
  );
  console.log(
    `  ${instances} instances (assumed)  ${total(instances, 24)} a day  ${total(instances, MONTH_HOURS)} for ${MONTH_HOURS} hours`,
  );
  console.log(
    `  ${ceiling} instances (ceiling)  ${total(ceiling, 24)} a day  ${total(ceiling, MONTH_HOURS)} for ${MONTH_HOURS} hours`,
  );
  console.log("EBS volumes of the instances, requests, API Gateway, and logs are not included.");

  if (instances > 0) {
    const rows = breakEvenTable(
      computePrices(prices.prices, config.instanceType),
      { instances, networkMonthlyUsd: usd(fixedMonthlyItems(network, MONTH_HOURS)) },
      [256, 512, 1024, 2048],
      durationMs,
    );
    console.log(
      `\nCheaper than standard Lambda (arm64) above this load, for requests of ${durationMs} ms:`,
    );
    for (const row of rows) {
      console.log(
        `  ${String(row.memoryMb).padStart(5)} MB function  ${row.concurrency.toFixed(1).padStart(5)} requests in flight on average  ${(row.requestsPerMonth / 1e6).toFixed(0).padStart(5)} million requests a month`,
      );
    }
    console.log(
      "Whether this fleet can carry that load depends on CPU time per request. Nothing here measures it.",
    );
  }
  process.exit(missing.length > 0 ? 2 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
