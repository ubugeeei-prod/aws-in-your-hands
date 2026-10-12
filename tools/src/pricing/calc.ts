import type { Allowances, Scenario, UnitPrice } from "./schema.ts";

// Integer nano-dollars (1e-9 USD): 0.0000002 USD per request is exact, and
// sums pick up no floating-point error.
const NANO = 1_000_000_000n;

function toNano(usd: string): bigint {
  const [whole = "0", fraction = ""] = usd.split(".");
  if (fraction.length > 10) {
    throw new Error(`Price ${usd} has more precision than this calculator keeps`);
  }
  // AWS publishes up to ten fractional digits, hence tenths of a nano-dollar.
  return BigInt(whole) * NANO * 10n + BigInt(fraction.padEnd(10, "0"));
}

/** Cost of `quantity` units under tiered pricing, in tenths of a nano-dollar. */
function tieredTenthNano(price: UnitPrice, quantity: number): bigint {
  let total = 0n;
  for (const tier of price.tiers) {
    const upper = tier.to ?? Number.POSITIVE_INFINITY;
    const inTier = Math.max(0, Math.min(quantity, upper) - tier.from);
    if (inTier > 0) {
      // Quantities have at most six decimal places (GB, for example).
      total += (toNano(tier.usd) * BigInt(Math.round(inTier * 1_000_000))) / 1_000_000n;
    }
  }
  return total;
}

export type LineResult = {
  priceId: string;
  unit: string;
  quantity: number;
  basis: string;
  /** List price, before any free allowance, credit, or discount. */
  listUsd: number;
  allowance: number | null;
  /** After subtracting the always-free allowance from the quantity. */
  afterAllowanceUsd: number;
};

export type ScenarioResult = {
  id: string;
  lines: LineResult[];
  listUsd: number;
  afterAllowanceUsd: number;
  /** Prices whose free allowance could not be confirmed; nothing was deducted for them. */
  unknownAllowances: string[];
};

const toUsd = (tenthNano: bigint): number => Number(tenthNano) / 1e10;
const roundCents = (usd: number): number => Math.round(usd * 100) / 100;

export function calculate(
  scenario: Scenario,
  prices: UnitPrice[],
  allowances: Allowances,
): ScenarioResult {
  let list = 0n;
  let afterAllowance = 0n;
  const lines = scenario.items.map((item): LineResult => {
    const price = prices.find((candidate) => candidate.id === item.priceId);
    if (price === undefined) {
      // A missing price is an error, never a silent zero.
      throw new Error(`Scenario ${scenario.id} uses unknown price "${item.priceId}"`);
    }
    const allowance =
      allowances.allowances.find((candidate) => candidate.priceId === item.priceId)?.quantity ??
      null;
    const lineList = tieredTenthNano(price, item.quantity);
    const lineAfter = tieredTenthNano(price, Math.max(0, item.quantity - (allowance ?? 0)));
    list += lineList;
    afterAllowance += lineAfter;
    return {
      priceId: item.priceId,
      unit: price.unit,
      quantity: item.quantity,
      basis: item.basis,
      listUsd: toUsd(lineList),
      allowance,
      afterAllowanceUsd: toUsd(lineAfter),
    };
  });

  return {
    id: scenario.id,
    lines,
    listUsd: roundCents(toUsd(list)),
    afterAllowanceUsd: roundCents(toUsd(afterAllowance)),
    unknownAllowances: allowances.unknown
      .map((entry) => entry.priceId)
      .filter((priceId) => scenario.items.some((item) => item.priceId === priceId)),
  };
}
