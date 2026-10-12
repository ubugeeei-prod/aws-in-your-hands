// The arithmetic of "when is a fleet cheaper than paying per request".
// Pure functions over prices: no AWS, no clock.

// #region model
export const MONTH_HOURS = 730;
export const MONTH_SECONDS = MONTH_HOURS * 3600;

export type ComputePrices = {
  /** Per request. The same on standard Lambda and on Managed Instances. */
  requestUsd: number;
  /** Standard Lambda, per GB of configured memory per second a request runs. */
  gbSecondUsd: number;
  /** EC2 On-Demand, per instance-hour. */
  instanceHourUsd: number;
  /** Lambda's fee per instance-hour: 15% of the On-Demand price, whatever you actually pay EC2. */
  managementHourUsd: number;
};

export type Load = { requestsPerMonth: number; durationMs: number };

export type Fleet = {
  instances: number;
  hours?: number;
  /** A Savings Plan or Reserved Instance rate, as a fraction off the EC2 price. Not applied to the fee. */
  ec2Discount?: number;
  /** What the VPC costs each month because the fleet lives in it. */
  networkMonthlyUsd?: number;
};
// #endregion model

// #region costs
/** Billed whether or not a request arrives. */
export function fleetMonthlyUsd(prices: ComputePrices, fleet: Fleet): number {
  const hours = fleet.instances * (fleet.hours ?? MONTH_HOURS);
  const ec2 = prices.instanceHourUsd * (1 - (fleet.ec2Discount ?? 0));
  return hours * (ec2 + prices.managementHourUsd) + (fleet.networkMonthlyUsd ?? 0);
}

export const managedMonthlyUsd = (prices: ComputePrices, load: Load, fleet: Fleet): number =>
  load.requestsPerMonth * prices.requestUsd + fleetMonthlyUsd(prices, fleet);

/** Standard Lambda: nothing while idle, then memory multiplied by time for every request. */
export const standardMonthlyUsd = (prices: ComputePrices, load: Load, memoryGb: number): number =>
  load.requestsPerMonth * prices.requestUsd +
  load.requestsPerMonth * (load.durationMs / 1000) * memoryGb * prices.gbSecondUsd;

/** How many requests are in flight at once, averaged over the month. */
export const averageConcurrency = (load: Load): number =>
  (load.requestsPerMonth * (load.durationMs / 1000)) / MONTH_SECONDS;
// #endregion costs

// #region break-even
/**
 * The average concurrency at which both bills are equal. Requests cost the same on
 * both sides and drop out, and so does the duration: one request in flight all month
 * is `memoryGb` GB for MONTH_SECONDS, however it is cut into requests.
 */
export const breakEvenConcurrency = (
  prices: ComputePrices,
  fleet: Fleet,
  memoryGb: number,
): number => fleetMonthlyUsd(prices, fleet) / (prices.gbSecondUsd * memoryGb * MONTH_SECONDS);

/** The same point as requests per month, for requests of one duration. */
export const breakEvenRequests = (
  prices: ComputePrices,
  fleet: Fleet,
  memoryGb: number,
  durationMs: number,
): number => (breakEvenConcurrency(prices, fleet, memoryGb) * MONTH_SECONDS) / (durationMs / 1000);
// #endregion break-even
