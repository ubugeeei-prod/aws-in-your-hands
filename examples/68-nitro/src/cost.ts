import type { InstanceType, NitroConfig } from "./config.ts";

// #region billable
/** The book's month. data/pricing/scenarios.json uses the same number. */
export const MONTH_HOURS = 730;

/** The AMI decides the root volume's size. 8 GiB is chapter 23's assumption, kept here. */
export const ASSUMED_ROOT_GIB = 8;

/** IDs in data/pricing/unit-prices.json. */
export const PRICE_IDS = {
  instanceHour: {
    "c6g.large": "ec2.c6g-large.linux.hour",
    "m6g.large": "ec2.m6g-large.linux.hour",
  } satisfies Record<InstanceType, string>,
  gp3GbMonth: "ebs.gp3.storage",
  publicIpv4Hour: "vpc.public-ipv4.in-use.hour",
  kmsKeyMonth: "kms.key",
} as const;

export type InstanceState = "running" | "stopped";
export type FixedItem = { priceId: string; quantity: number; basis: string };

const share = (hours: number): number => Math.round((hours / MONTH_HOURS) * 1e6) / 1e6;

/**
 * What this stack is billed for over `hours`, before one enclave is started.
 * An enclave is carved out of the instance and adds no line of its own.
 */
export function fixedItems(
  config: Pick<NitroConfig, "instanceType">,
  state: InstanceState,
  hours: number = MONTH_HOURS,
): FixedItem[] {
  const items: FixedItem[] = [];
  if (state === "running") {
    items.push({
      priceId: PRICE_IDS.instanceHour[config.instanceType],
      quantity: hours,
      basis: `1 ${config.instanceType} x ${hours} hours`,
    });
    // Auto-assigned, so it is released when the instance stops.
    items.push({
      priceId: PRICE_IDS.publicIpv4Hour,
      quantity: hours,
      basis: `1 public IPv4 address x ${hours} hours`,
    });
  }
  items.push({
    priceId: PRICE_IDS.gp3GbMonth,
    quantity: Math.round(ASSUMED_ROOT_GIB * share(hours) * 1e6) / 1e6,
    basis: `${ASSUMED_ROOT_GIB} GiB root (assumed), ${hours} of ${MONTH_HOURS} hours`,
  });
  // The key is billed for existing, whether anything is ever decrypted with it.
  items.push({
    priceId: PRICE_IDS.kmsKeyMonth,
    quantity: share(hours),
    basis: `1 customer managed key, ${hours} of ${MONTH_HOURS} hours`,
  });
  return items;
}
// #endregion billable
