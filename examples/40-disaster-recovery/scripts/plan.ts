// vp run dr:plan [key=value ...]
//
// Prints whether the chapter 23 instance fits what Elastic Disaster Recovery documents,
// which network paths the agent and the staging area would have, the idle cost, and the
// commands for the steps that exist only as API calls. Reads only this checkout: no AWS.
//
// DR settings: placement, pitRetentionDays. Source facts: kernel, architecture.
// Network settings (the ones you deploy chapter 11 with): egress, interfaceEndpoints.

import { parseNetworkConfig } from "@aih/example-11-network/src/config.ts";
import { planNetwork } from "@aih/example-11-network/src/plan.ts";
import { networkSettingsFor } from "@aih/example-23-ec2/src/cost.ts";
import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { drConfigSchema, parseDrConfig, REGION } from "../src/config.ts";
import { drillItems, type FixedItem, MONTH_HOURS, protectionItems } from "../src/cost.ts";
import { checkPaths, stagingSubnet, unreachable } from "../src/network.ts";
import { blockers, checkSource } from "../src/source.ts";
import { oldestRecoveryPoint, setupCommands } from "../src/templates.ts";

const settings = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf("=");
    if (separator < 1) {
      throw new Error(`expected key=value, got "${argument}"`);
    }
    return [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);
const drKeys = new Set(Object.keys(drConfigSchema.entries));
const sourceKeys = new Set(["kernel", "architecture"]);

try {
  const config = parseDrConfig(
    Object.fromEntries(Object.entries(settings).filter(([key]) => drKeys.has(key))),
  );
  const given = Object.fromEntries(
    Object.entries(settings).filter(([key]) => !drKeys.has(key) && !sourceKeys.has(key)),
  );
  // With no network settings given, assume the ones chapter 23 needs for this placement.
  const network = planNetwork(
    parseNetworkConfig(
      Object.keys(given).length > 0 ? given : networkSettingsFor(config.placement),
    ),
  );

  // Chapter 23 asks for the default-kernel AMI, which the AL2023 guide says is 6.18 since August 2026.
  // Pass what the instance really runs: kernel=$(uname -r).
  const kernel = settings["kernel"] ?? "6.18";
  const findings = checkSource({
    os: "amazon-linux-2023",
    kernel,
    architecture: settings["architecture"] === "x86_64" ? "x86_64" : "aarch64",
    origin: "ec2",
    mountedDisks: 2,
  });
  console.log(`Source    chapter 23 instance, Amazon Linux 2023, kernel ${kernel}`);
  for (const finding of findings) {
    console.log(`  ${finding.level === "blocker" ? "BLOCKER" : "note   "} ${finding.message}`);
  }

  console.log(
    `\nStaging   ${stagingSubnet(config.placement)}, point-in-time retention ${config.pitRetentionDays} days`,
  );
  console.log(
    `  oldest recovery point if a disaster were declared now: ${oldestRecoveryPoint(new Date(), config.pitRetentionDays).toISOString()}`,
  );
  const checks = checkPaths(config.placement, network);
  for (const check of checks) {
    const result = check.path.reachable
      ? `via ${check.path.via}`
      : `UNREACHABLE (${check.path.reason})`;
    console.log(
      `  ${check.subnet.padEnd(9)} -> ${check.service.padEnd(4)} :${check.port}  ${result.padEnd(28)} ${check.why}`,
    );
  }
  console.log(
    `  source    -> staging :1500  inside the VPC, if the source's security group allows it`,
  );

  const { prices, allowances } = loadPricing();
  const cost = (items: FixedItem[]): string =>
    calculate(
      {
        id: "dr-plan",
        chapter: "40",
        title: { ja: "", en: "" },
        assumptions: { ja: [], en: [] },
        items,
      },
      prices.prices,
      allowances,
    ).listUsd.toFixed(2);
  console.log(
    `\nFixed cost of protecting one server, list price (USD), on top of chapters 11 and 23:`,
  );
  console.log(
    `  idle      ${cost(protectionItems(config, 24)).padStart(6)} a day   ${cost(protectionItems(config)).padStart(6)} for ${MONTH_HOURS} hours`,
  );
  console.log(
    `  one drill ${cost(drillItems(config, 2)).padStart(6)} for an instance kept 2 hours`,
  );
  console.log(
    "Not included, amount unknown: incremental snapshots, the replication server's own volume, I/O requests\n" +
      "on magnetic staging disks, endpoint data processing, transfer between zones, surplus CPU credits, the conversion server.",
  );

  console.log(`\nSteps that are API calls, not resources (run them yourself, in this order):`);
  for (const command of setupCommands(config, REGION)) {
    console.log(`  ${command}`);
  }

  const failed = blockers(findings).length > 0 || unreachable(checks).length > 0;
  process.exit(failed ? 2 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
