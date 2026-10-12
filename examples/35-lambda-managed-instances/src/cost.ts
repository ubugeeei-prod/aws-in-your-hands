import { type InstanceType, VCPUS_PER_INSTANCE } from "./config.ts";

// #region billable
/** The book's month. data/pricing/scenarios.json uses the same number. */
export const MONTH_HOURS = 730;

/**
 * What Lambda launches when the first function version is published, according to its guide.
 * Nothing documents the count for other minimums, so this stays a stated assumption.
 */
export const DEFAULT_INSTANCES = 3;

/** IDs in data/pricing/unit-prices.json. */
export const PRICE_IDS = {
  instanceHour: {
    "m6g.large": "ec2.m6g-large.linux.hour",
    "m7g.large": "ec2.m7g-large.linux.hour",
  } satisfies Record<InstanceType, string>,
  managementHour: {
    "m6g.large": "lambda.managed-instances.m6g-large.management.hour",
    "m7g.large": "lambda.managed-instances.m7g-large.management.hour",
  } satisfies Record<InstanceType, string>,
  request: "lambda.managed-instances.request.arm",
} as const;

export type FixedItem = { priceId: string; quantity: number; basis: string };

/** What a fleet is billed for over `hours`, before a single request: EC2's price and Lambda's fee on top. */
export function fleetItems(
  instanceType: InstanceType,
  instances: number,
  hours: number = MONTH_HOURS,
): FixedItem[] {
  if (instances === 0) {
    return [];
  }
  const basis = `${instances} ${instanceType} x ${hours} hours`;
  return [
    { priceId: PRICE_IDS.instanceHour[instanceType], quantity: instances * hours, basis },
    // Billed per instance-hour like the instance, and no Savings Plan reduces it.
    {
      priceId: PRICE_IDS.managementHour[instanceType],
      quantity: instances * hours,
      basis: `management fee, ${basis}`,
    },
  ];
}

/** The most instances the capacity provider may run at once. */
export const instanceCeiling = (maxVCpuCount: number): number =>
  Math.floor(maxVCpuCount / VCPUS_PER_INSTANCE);
// #endregion billable
