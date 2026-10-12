import { describe, expect, it } from "vite-plus/test";

import { loadPricing } from "@aih/tools/data/load.ts";

import {
  averageConcurrency,
  breakEvenConcurrency,
  breakEvenRequests,
  type ComputePrices,
  fleetMonthlyUsd,
  managedMonthlyUsd,
  MONTH_SECONDS,
  standardMonthlyUsd,
} from "../src/break-even.ts";
import { computePrices } from "../src/prices.ts";
import { breakEvenTable } from "../src/report.ts";

describe("the arithmetic, against the example on the Lambda pricing page", () => {
  // us-east-1, m7g.xlarge, a 3-year Compute Savings Plan at 72% off, about 2,000 instance-hours.
  const page: ComputePrices = {
    requestUsd: 0.0000002,
    gbSecondUsd: 0.0000133334,
    instanceHourUsd: 0.1632,
    managementHourUsd: 0.1632 * 0.15,
  };

  it("comes to the page's total, give or take its rounding of the hourly rate", () => {
    const usd = managedMonthlyUsd(
      page,
      { requestsPerMonth: 100e6, durationMs: 200 },
      { instances: 1, hours: 2000, ec2Discount: 0.72 },
    );
    // The page rounds 0.045696 to 0.0457 before multiplying: 160.36.
    expect(usd).toBeCloseTo(160.35, 2);
  });

  it("takes the discount off the instance and leaves the fee alone", () => {
    const fleet = { instances: 1, hours: 2000 };
    const saved =
      fleetMonthlyUsd(page, fleet) - fleetMonthlyUsd(page, { ...fleet, ec2Discount: 0.72 });
    expect(saved).toBeCloseTo(2000 * 0.1632 * 0.72, 6);
    expect(fleetMonthlyUsd(page, { ...fleet, ec2Discount: 1 })).toBeCloseTo(48.96, 6);
  });
});

describe("the break-even in Tokyo, from data/pricing", () => {
  const prices = computePrices(loadPricing().prices.prices, "m6g.large");
  // Three m6g.large, and one interface endpoint in two zones.
  const fleet = { instances: 3, networkMonthlyUsd: 20.44 };

  it("bills the fleet the same in a month with no requests", () => {
    expect(fleetMonthlyUsd(prices, fleet)).toBeCloseTo(269.77, 2);
    expect(managedMonthlyUsd(prices, { requestsPerMonth: 0, durationMs: 100 }, fleet)).toBeCloseTo(
      269.77,
      2,
    );
    expect(standardMonthlyUsd(prices, { requestsPerMonth: 0, durationMs: 100 }, 1)).toBe(0);
  });

  it("is a number of requests in flight, set by the memory of the standard function", () => {
    const table = breakEvenTable(prices, fleet, [256, 512, 1024, 2048], 100);
    expect(table.map((row) => [row.memoryMb, Number(row.concurrency.toFixed(1))])).toEqual([
      [256, 30.8],
      [512, 15.4],
      [1024, 7.7],
      [2048, 3.8],
    ]);
  });

  it("does not move with the duration of a request, only the request count does", () => {
    const short = breakEvenRequests(prices, fleet, 1, 50);
    const long = breakEvenRequests(prices, fleet, 1, 200);
    expect(short / long).toBeCloseTo(4, 10);
    expect(averageConcurrency({ requestsPerMonth: short, durationMs: 50 })).toBeCloseTo(
      breakEvenConcurrency(prices, fleet, 1),
      10,
    );
    expect(Math.round(long / 1e6)).toBe(101);
  });

  it("puts both bills level at the break-even, and the fleet ahead above it", () => {
    const requestsPerMonth = breakEvenRequests(prices, fleet, 1, 200);
    const at = { requestsPerMonth, durationMs: 200 };
    expect(standardMonthlyUsd(prices, at, 1)).toBeCloseTo(managedMonthlyUsd(prices, at, fleet), 6);

    const above = { requestsPerMonth: requestsPerMonth * 2, durationMs: 200 };
    expect(standardMonthlyUsd(prices, above, 1)).toBeGreaterThan(
      managedMonthlyUsd(prices, above, fleet),
    );
  });

  it("needs a third of the load once the fleet is one instance", () => {
    const one = { instances: 1, networkMonthlyUsd: 20.44 };
    expect(breakEvenConcurrency(prices, one, 1)).toBeCloseTo(2.955, 3);
  });

  it("counts a month as 730 hours", () => {
    expect(MONTH_SECONDS).toBe(2_628_000);
  });
});
