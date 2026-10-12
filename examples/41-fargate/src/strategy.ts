export const PROVIDERS = ["FARGATE", "FARGATE_SPOT"] as const;
export type Provider = (typeof PROVIDERS)[number];

export type StrategyItem = { capacityProvider: Provider; base?: number; weight: number };

// #region rules
/** Why ECS would refuse a strategy, or why it would not do what it looks like. Empty when it is fine. */
export function strategyProblems(items: readonly StrategyItem[]): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, message: string): void => void (ok || problems.push(message));

  check(items.length >= 1 && items.length <= 20, "a strategy names 1 to 20 capacity providers");
  check(
    new Set(items.map((item) => item.capacityProvider)).size === items.length,
    "each capacity provider appears once",
  );
  check(
    items.filter((item) => (item.base ?? 0) > 0).length <= 1,
    "only one capacity provider can have a base",
  );
  check(
    items.every((item) => Number.isInteger(item.weight) && item.weight >= 0 && item.weight <= 1000),
    "a weight is an integer from 0 to 1000",
  );
  check(
    items.every((item) => {
      const base = item.base ?? 0;
      return Number.isInteger(base) && base >= 0 && base <= 100_000;
    }),
    "a base is an integer from 0 to 100000",
  );
  check(
    items.some((item) => item.weight > 0),
    "at least one capacity provider needs a weight above zero",
  );
  return problems;
}
// #endregion rules

// #region split
/**
 * How many of `tasks` tasks land on each provider: the base first, the rest by weight.
 * The documentation gives the ratio, not the rounding. This model hands out the
 * remainder one task at a time to whichever provider is furthest below its share.
 */
export function splitTasks(
  items: readonly StrategyItem[],
  tasks: number,
): Record<Provider, number> {
  const problems = strategyProblems(items);
  if (problems.length > 0) {
    throw new Error(`invalid capacity provider strategy: ${problems.join("; ")}`);
  }
  const placed: Record<Provider, number> = { FARGATE: 0, FARGATE_SPOT: 0 };
  let left = tasks;
  for (const item of items) {
    const base = Math.min(item.base ?? 0, left);
    placed[item.capacityProvider] += base;
    left -= base;
  }
  const weighted = items.filter((item) => item.weight > 0);
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const beyondBase: Record<Provider, number> = { FARGATE: 0, FARGATE_SPOT: 0 };
  for (let placedSoFar = 0; placedSoFar < left; placedSoFar += 1) {
    // The provider whose count is furthest below its share of the tasks placed so far, plus this one.
    const [next] = weighted.toSorted(
      (a, b) =>
        beyondBase[a.capacityProvider] / a.weight - beyondBase[b.capacityProvider] / b.weight ||
        b.weight - a.weight,
    );
    if (next === undefined || totalWeight === 0) {
      break;
    }
    beyondBase[next.capacityProvider] += 1;
    placed[next.capacityProvider] += 1;
  }
  return placed;
}
// #endregion split
