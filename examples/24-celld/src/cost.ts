import { parseNetworkConfig } from "@aih/example-11-network/src/config.ts";
import { fixedMonthlyItems } from "@aih/example-11-network/src/cost.ts";
import { planNetwork } from "@aih/example-11-network/src/plan.ts";
import { networkSettingsFor } from "@aih/example-23-ec2/src/cost.ts";
import { DOCUMENTED } from "./celld.ts";
import type { FleetConfig, InstanceType } from "./config.ts";

// #region billable
/** The book's month. data/pricing/scenarios.json uses the same number. */
export const MONTH_HOURS = 730;

/** The AMI decides the root volume's size. 8 GiB is an assumption carried over from chapter 23, not a measured value. */
export const ASSUMED_ROOT_GIB = 8;

/** IDs in data/pricing/unit-prices.json. */
export const PRICE_IDS = {
  instanceHour: {
    "t4g.micro": "ec2.t4g-micro.linux.hour",
    "t4g.small": "ec2.t4g-small.linux.hour",
  } satisfies Record<InstanceType, string>,
  gp3GbMonth: "ebs.gp3.storage",
  s3Write: "s3.request.tier1",
  s3Read: "s3.request.tier2",
} as const;

export type FleetState = "running" | "stopped" | "destroyed";
export type FixedItem = { priceId: string; quantity: number; basis: string };

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * Requests one idle node sends to the bucket, from the intervals celld documents:
 * a lease renewal every third of CELLD_TTL_MS, the fleet sample every
 * CELLD_REBALANCE_INTERVAL_MS, the deployment pointer every CELLD_DEPLOY_POLL_S.
 * A lower bound read off the documentation, not a measurement.
 */
export function idleRequestsPerNode(hours: number): { writes: number; reads: number } {
  const seconds = hours * 3600;
  return {
    writes: round(seconds / (DOCUMENTED.leaseTtlMs / 3 / 1000)),
    reads: round(seconds / (DOCUMENTED.fleetSampleMs / 1000) + seconds / DOCUMENTED.deployPollSeconds),
  };
}

/** What the fleet's own resources are billed for over `hours` in one state, before a single request from a user. */
export function fleetItems(
  config: Pick<FleetConfig, "nodes" | "instanceType" | "dataVolumeGiB" | "stateOnDestroy">,
  state: FleetState,
  hours: number = MONTH_HOURS,
): FixedItem[] {
  const { nodes } = config;
  const items: FixedItem[] = [];
  if (nodes === 0) {
    return items;
  }
  if (state === "running") {
    items.push({
      priceId: PRICE_IDS.instanceHour[config.instanceType],
      quantity: nodes * hours,
      basis: `${nodes} ${config.instanceType} x ${hours} hours`,
    });
  }
  if (state === "destroyed") {
    // Root volumes go with their instances. Retained data volumes do not.
    if (config.stateOnDestroy === "retain") {
      items.push({
        priceId: PRICE_IDS.gp3GbMonth,
        quantity: round((nodes * config.dataVolumeGiB * hours) / MONTH_HOURS),
        basis: `${nodes} retained data volume(s) x ${config.dataVolumeGiB} GiB, ${hours} of ${MONTH_HOURS} hours`,
      });
    }
    return items;
  }
  items.push({
    priceId: PRICE_IDS.gp3GbMonth,
    quantity: round((nodes * (ASSUMED_ROOT_GIB + config.dataVolumeGiB) * hours) / MONTH_HOURS),
    basis: `${nodes} x (${ASSUMED_ROOT_GIB} GiB root, assumed + ${config.dataVolumeGiB} GiB data), ${hours} of ${MONTH_HOURS} hours`,
  });
  if (state === "running") {
    const requests = idleRequestsPerNode(hours);
    items.push(
      {
        priceId: PRICE_IDS.s3Write,
        quantity: round(nodes * requests.writes),
        basis: `${nodes} node(s) x one lease renewal about every ${(DOCUMENTED.leaseTtlMs / 3000).toFixed(1)} s (estimated from the documented interval)`,
      },
      {
        priceId: PRICE_IDS.s3Read,
        quantity: round(nodes * requests.reads),
        basis: `${nodes} node(s) x (fleet sample every ${DOCUMENTED.fleetSampleMs / 1000} s + deployment pointer every ${DOCUMENTED.deployPollSeconds} s), estimated`,
      },
    );
  }
  return items;
}

/**
 * The fleet's items plus the chapter 11 endpoints the nodes need to reach Systems Manager.
 * The endpoints belong to that stack: stopping or destroying this one does not remove them.
 */
export function allFixedItems(
  config: Pick<FleetConfig, "nodes" | "instanceType" | "dataVolumeGiB" | "stateOnDestroy">,
  state: FleetState,
  hours: number = MONTH_HOURS,
  endpointsDeployed: boolean = config.nodes > 0,
): FixedItem[] {
  const network = planNetwork(parseNetworkConfig(endpointsDeployed ? networkSettingsFor("private") : {}));
  return [...fleetItems(config, state, hours), ...fixedMonthlyItems(network, hours)];
}
// #endregion billable
