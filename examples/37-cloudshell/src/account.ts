import * as v from "valibot";

import type { Identity } from "@aih/tools/aws/target.ts";

// What `aws sts get-caller-identity` and `aws budgets describe-budget` print, and what to
// say about it.

// #region caller
export const callerSchema = v.object({
  Account: v.pipe(v.string(), v.regex(/^\d{12}$/, "not an account ID")),
  Arn: v.pipe(v.string(), v.startsWith("arn:")),
});

export const identityOf = (caller: v.InferOutput<typeof callerSchema>): Identity => ({
  accountId: caller.Account,
  arn: caller.Arn,
});
// #endregion caller

// #region budget
// Amounts arrive as decimal strings. A refund or a credit can make spend negative.
const amount = v.object({
  Amount: v.pipe(v.string(), v.regex(/^-?\d+(\.\d+)?$/, "not a decimal amount")),
  Unit: v.string(),
});

export const budgetSchema = v.object({
  Budget: v.object({
    BudgetName: v.string(),
    BudgetLimit: amount,
    CalculatedSpend: v.optional(
      v.object({ ActualSpend: amount, ForecastedSpend: v.optional(amount) }),
    ),
  }),
});
export type BudgetAnswer = v.InferOutput<typeof budgetSchema>;

export type BudgetReport = {
  name: string;
  unit: string;
  limit: string;
  actual: string | undefined;
  forecast: string | undefined;
  state: "no-data" | "within" | "forecast-over" | "over";
};

/** Compares as numbers: good enough to say which side of the limit a figure is on. */
export function budgetReport(answer: BudgetAnswer): BudgetReport {
  const { BudgetName, BudgetLimit, CalculatedSpend } = answer.Budget;
  const limit = Number(BudgetLimit.Amount);
  const actual = CalculatedSpend?.ActualSpend;
  const forecast = CalculatedSpend?.ForecastedSpend;
  // A figure in another currency cannot be set against the limit.
  const comparable = (figure: typeof actual) =>
    figure !== undefined && figure.Unit === BudgetLimit.Unit ? Number(figure.Amount) : undefined;
  const spent = comparable(actual);
  const expected = comparable(forecast);
  return {
    name: BudgetName,
    unit: BudgetLimit.Unit,
    limit: BudgetLimit.Amount,
    actual: actual?.Amount,
    forecast: forecast?.Amount,
    state:
      spent === undefined
        ? "no-data"
        : spent > limit
          ? "over"
          : expected !== undefined && expected > limit
            ? "forecast-over"
            : "within",
  };
}

export function renderBudget(report: BudgetReport): string[] {
  const line = (label: string, value: string | undefined) =>
    `${label} ${value === undefined ? "(not reported)" : `${value} ${report.unit}`}`;
  const verdict = {
    "no-data": "No spend is reported for this period yet.",
    within: "Spend and forecast are within the limit.",
    "forecast-over": "The forecast for this period is above the limit.",
    over: "Spend is already above the limit.",
  }[report.state];
  return [
    `budget:   ${report.name}`,
    line("limit:   ", report.limit),
    line("actual:  ", report.actual),
    line("forecast:", report.forecast),
    verdict,
    // A budget only notifies. Nothing stops when the limit is passed.
    "A budget sends a notification; it does not stop anything.",
  ];
}
// #endregion budget
