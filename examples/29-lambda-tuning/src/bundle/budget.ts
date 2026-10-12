// #region budget
/**
 * The most the deployed bundle may weigh. A test fails past it, so a dependency that
 * doubles the bundle is a decision somebody made, not something found in a cold start.
 */
export const BUDGET = { bytes: 400_000, gzipBytes: 125_000 } as const;
// #endregion budget

export type Weight = { bytes: number; gzipBytes: number };

// #region check
export function overBudget(weight: Weight, budget: Weight = BUDGET): string[] {
  const problems: string[] = [];
  if (weight.bytes > budget.bytes) {
    problems.push(`${weight.bytes} bytes, ${weight.bytes - budget.bytes} over the budget`);
  }
  if (weight.gzipBytes > budget.gzipBytes) {
    problems.push(
      `${weight.gzipBytes} bytes gzipped, ${weight.gzipBytes - budget.gzipBytes} over the budget`,
    );
  }
  return problems;
}
// #endregion check
