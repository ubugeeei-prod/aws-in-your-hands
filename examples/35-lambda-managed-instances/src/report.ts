import { fixedMonthlyItems } from "@aih/example-11-network/src/cost.ts";
import type { NetworkPlan } from "@aih/example-11-network/src/plan.ts";

import {
  breakEvenConcurrency,
  breakEvenRequests,
  type ComputePrices,
  type Fleet,
} from "./break-even.ts";
import { FUNCTION_MEMORY_MB, type ManagedConfig } from "./config.ts";
import { type FixedItem, fleetItems, instanceCeiling } from "./cost.ts";
import { checkAccess } from "./network.ts";

// #region report
/** Everything billed by the hour for the fleet and the network it needs. */
export function allFixedItems(
  config: ManagedConfig,
  network: NetworkPlan,
  instances: number,
  hours: number,
): FixedItem[] {
  return [
    ...fleetItems(config.instanceType, instances, hours),
    ...fixedMonthlyItems(network, hours),
  ];
}

/** What `vp run lmi:plan` prints, without the prices. Same input, same output. */
export function describePlan(config: ManagedConfig, network: NetworkPlan): string[] {
  const lines = [
    `Function  ${FUNCTION_MEMORY_MB} MB (1 vCPU), nodejs24.x arm64, ${config.minExecutionEnvironments} to ${config.maxExecutionEnvironments} execution environments`,
    `Fleet     ${config.instanceType} only, at most ${config.maxVCpuCount} vCPUs (${instanceCeiling(config.maxVCpuCount)} instances)`,
    `Inbound   nothing`,
    "",
    "From the capacity provider's subnets, on port 443:",
  ];
  for (const check of checkAccess(network)) {
    const result = check.path.reachable
      ? `via ${check.path.via}`
      : `UNREACHABLE (${check.path.reason})`;
    lines.push(`  ${check.subnetId.padEnd(9)} ${check.service.padEnd(6)} ${result}`);
  }
  return lines;
}

export type BreakEvenRow = { memoryMb: number; concurrency: number; requestsPerMonth: number };

/** For each memory size a standard function might have: the load above which the fleet is cheaper. */
export const breakEvenTable = (
  prices: ComputePrices,
  fleet: Fleet,
  memoriesMb: readonly number[],
  durationMs: number,
): BreakEvenRow[] =>
  memoriesMb.map((memoryMb) => ({
    memoryMb,
    concurrency: breakEvenConcurrency(prices, fleet, memoryMb / 1024),
    requestsPerMonth: breakEvenRequests(prices, fleet, memoryMb / 1024, durationMs),
  }));
// #endregion report
