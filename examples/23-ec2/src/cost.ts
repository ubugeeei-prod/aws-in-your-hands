import { SSM_SERVICES } from "./access.ts";
import type { Ec2Config, InstanceType, Placement } from "./config.ts";

// #region billable
/** The book's month. data/pricing/scenarios.json uses the same number. */
export const MONTH_HOURS = 730;

/** The AMI decides the root volume's size. 8 GiB is this chapter's assumption, not a measured value. */
export const ASSUMED_ROOT_GIB = 8;

/** IDs in data/pricing/unit-prices.json. */
export const PRICE_IDS = {
  instanceHour: {
    "t4g.micro": "ec2.t4g-micro.linux.hour",
    "t4g.small": "ec2.t4g-small.linux.hour",
  } satisfies Record<InstanceType, string>,
  gp3GbMonth: "ebs.gp3.storage",
  publicIpv4Hour: "vpc.public-ipv4.in-use.hour",
} as const;

export type InstanceState = "running" | "stopped";
export type FixedItem = { priceId: string; quantity: number; basis: string };

/** What this stack is billed for over `hours` in one state, before a single request. */
export function fixedItems(
  config: Pick<Ec2Config, "placement" | "instanceType" | "dataVolumeGiB">,
  state: InstanceState,
  hours: number = MONTH_HOURS,
): FixedItem[] {
  const gib = ASSUMED_ROOT_GIB + config.dataVolumeGiB;
  const items: FixedItem[] = [];
  if (state === "running") {
    items.push({
      priceId: PRICE_IDS.instanceHour[config.instanceType],
      quantity: hours,
      basis: `1 ${config.instanceType} x ${hours} hours`,
    });
  }
  // Volumes are billed for existing, whether the instance runs or not.
  items.push({
    priceId: PRICE_IDS.gp3GbMonth,
    quantity: Math.round(((gib * hours) / MONTH_HOURS) * 1e6) / 1e6,
    basis: `${ASSUMED_ROOT_GIB} GiB root (assumed) + ${config.dataVolumeGiB} GiB data, ${hours} of ${MONTH_HOURS} hours`,
  });
  if (config.placement === "public" && state === "running") {
    // An auto-assigned address is released when the instance stops. An Elastic IP address would not be.
    items.push({
      priceId: PRICE_IDS.publicIpv4Hour,
      quantity: hours,
      basis: `1 public IPv4 address x ${hours} hours`,
    });
  }
  return items;
}

/**
 * What to pass to the chapter 11 stack so the instance can reach Systems Manager.
 * The endpoints are that stack's resources: its cost function prices them, and
 * stopping this instance does not stop them.
 */
export const networkSettingsFor = (placement: Placement): Record<string, string> =>
  placement === "private" ? { interfaceEndpoints: SSM_SERVICES.join(",") } : {};
// #endregion billable
