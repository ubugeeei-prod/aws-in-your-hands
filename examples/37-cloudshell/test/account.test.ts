import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { budgetReport, budgetSchema, callerSchema, renderBudget } from "../src/account.ts";
import { budget, caller } from "./support/fixtures.ts";

const withSpend = (actual: string, forecast?: string, unit = "USD") =>
  v.parse(budgetSchema, {
    Budget: {
      ...budget.Budget,
      CalculatedSpend: {
        ActualSpend: { Amount: actual, Unit: unit },
        ...(forecast === undefined ? {} : { ForecastedSpend: { Amount: forecast, Unit: unit } }),
      },
    },
  });

describe("the caller", () => {
  it("is read from what get-caller-identity prints", () => {
    expect(v.parse(callerSchema, caller)).toEqual({ Account: caller.Account, Arn: caller.Arn });
  });

  it("is refused when the account is not twelve digits", () => {
    expect(v.safeParse(callerSchema, { ...caller, Account: "1111" }).success).toBe(false);
  });
});

describe("the budget report", () => {
  it("says the forecast is over while spend is still under", () => {
    expect(budgetReport(v.parse(budgetSchema, budget))).toMatchObject({
      limit: "10",
      actual: "3.412",
      forecast: "12.8",
      state: "forecast-over",
    });
  });

  it("says over once spend passes the limit", () => {
    expect(budgetReport(withSpend("10.01", "30")).state).toBe("over");
  });

  it("says within at the limit exactly and below it", () => {
    expect(budgetReport(withSpend("10", "10")).state).toBe("within");
    expect(budgetReport(withSpend("-1.5")).state).toBe("within");
  });

  it("does not compare a figure in another currency with the limit", () => {
    expect(budgetReport(withSpend("999", "999", "JPY")).state).toBe("no-data");
  });

  it("says there is no data when the budget reports no spend", () => {
    const answer = v.parse(budgetSchema, {
      Budget: { BudgetName: "aih-monthly", BudgetLimit: budget.Budget.BudgetLimit },
    });
    expect(budgetReport(answer).state).toBe("no-data");
    expect(renderBudget(budgetReport(answer))).toContain("actual:   (not reported)");
  });

  it("refuses an amount that is not a decimal number", () => {
    const broken = { Budget: { ...budget.Budget, BudgetLimit: { Amount: "ten", Unit: "USD" } } };
    expect(v.safeParse(budgetSchema, broken).success).toBe(false);
  });

  it("always says that a budget does not stop anything", () => {
    expect(renderBudget(budgetReport(withSpend("50"))).at(-1)).toMatch(/does not stop/);
  });
});
