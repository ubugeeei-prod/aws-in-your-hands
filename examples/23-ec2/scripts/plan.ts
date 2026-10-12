// vp run ec2:plan [key=value ...]
//
// Prints where the instance would live, whether it could reach Systems
// Manager through the chapter 11 network, and what both cost while idle.
// Reads only this checkout: no AWS, no credentials.
//
// EC2 settings: placement, instanceType, dataVolumeGiB, dataOnDestroy, amiId.
// Network settings (the ones you deploy chapter 11 with): egress, interfaceEndpoints.

import { parseNetworkConfig } from "@aih/example-11-network/src/config.ts";
import { planNetwork } from "@aih/example-11-network/src/plan.ts";
import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { checkAccess, unreachable } from "../src/access.ts";
import { ec2ConfigSchema, parseEc2Config } from "../src/config.ts";
import { type InstanceState, MONTH_HOURS, networkSettingsFor } from "../src/cost.ts";
import { allFixedItems, describePlan } from "../src/report.ts";

const settings = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf("=");
    if (separator < 1) {
      throw new Error(`expected key=value, got "${argument}"`);
    }
    return [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);
const ec2Keys = new Set(Object.keys(ec2ConfigSchema.entries));
const pick = (mine: boolean) =>
  Object.fromEntries(Object.entries(settings).filter(([key]) => ec2Keys.has(key) === mine));

try {
  const config = parseEc2Config(pick(true));
  const given = pick(false);
  // With no network settings given, assume the ones this placement needs.
  const networkSettings =
    Object.keys(given).length > 0 ? given : networkSettingsFor(config.placement);
  const network = planNetwork(parseNetworkConfig(networkSettings));
  const flags = Object.entries(networkSettings).map(([key, value]) => ` -c ${key}=${value}`);
  console.log(`Network   vp run net:infra:deploy${flags.join("")}`);
  console.log(describePlan(config, network).join("\n"));

  const missing = unreachable(checkAccess(config.placement, network));
  if (missing.length > 0) {
    console.log(
      `\nThe instance would start, but Systems Manager would never see it: no path to ${missing.join(", ")}.`,
    );
  }

  const { prices, allowances } = loadPricing();
  const cost = (state: InstanceState, hours: number): string =>
    calculate(
      {
        id: "ec2-plan",
        chapter: "23",
        title: { ja: "", en: "" },
        assumptions: { ja: [], en: [] },
        items: allFixedItems(config, network, state, hours),
      },
      prices.prices,
      allowances,
    ).listUsd.toFixed(2);
  console.log(`\nFixed cost, list price, instance and network together (USD):`);
  console.log(
    `  running   ${cost("running", 24).padStart(6)} a day   ${cost("running", MONTH_HOURS).padStart(6)} for ${MONTH_HOURS} hours`,
  );
  console.log(
    `  stopped   ${cost("stopped", 24).padStart(6)} a day   ${cost("stopped", MONTH_HOURS).padStart(6)} for ${MONTH_HOURS} hours`,
  );
  console.log("Data transfer, snapshots, and surplus CPU credits are not included.");
  process.exit(missing.length > 0 ? 2 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
