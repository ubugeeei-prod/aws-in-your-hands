import type { UnitPrice } from "@aih/tools/pricing/schema.ts";

import type { ComputePrices } from "./break-even.ts";
import type { InstanceType } from "./config.ts";
import { PRICE_IDS } from "./cost.ts";

// #region prices
/** The first tier of a price from data/pricing/unit-prices.json, as a number. A missing ID is an error, never 0. */
export function firstTierUsd(prices: readonly UnitPrice[], id: string): number {
  const tier = prices.find((price) => price.id === id)?.tiers[0];
  if (tier === undefined) {
    throw new Error(`data/pricing/unit-prices.json has no price "${id}"`);
  }
  return Number(tier.usd);
}

/**
 * Tokyo, arm64, On-Demand. The GB-second price is the first tier, which covers the
 * first 7.5 billion GB-seconds a month: far above any break-even this chapter computes.
 */
export const computePrices = (
  prices: readonly UnitPrice[],
  instanceType: InstanceType,
): ComputePrices => ({
  requestUsd: firstTierUsd(prices, PRICE_IDS.request),
  gbSecondUsd: firstTierUsd(prices, "lambda.duration.arm"),
  instanceHourUsd: firstTierUsd(prices, PRICE_IDS.instanceHour[instanceType]),
  managementHourUsd: firstTierUsd(prices, PRICE_IDS.managementHour[instanceType]),
});
// #endregion prices
