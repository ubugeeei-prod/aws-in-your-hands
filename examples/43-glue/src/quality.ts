import { type Column, ROUTES } from "@aih/example-26-analytics/src/record.ts";

// #region rules
export type Rule =
  | { type: "IsComplete"; column: Column }
  | { type: "IsUnique"; column: Column }
  | { type: "ColumnValues"; column: Column; is: Expression };

export type Expression =
  | { op: "=" | ">="; value: number }
  // DQDL's `between` leaves both ends out.
  | { op: "between"; above: number; below: number }
  | { op: "in"; values: readonly string[] };

/** What a day's rows must satisfy before they replace the day's folder. */
export const RULES: readonly Rule[] = [
  { type: "IsComplete", column: "event_id" },
  // The job has just removed the duplicates. This fails if that step is ever lost.
  { type: "IsUnique", column: "event_id" },
  { type: "IsComplete", column: "at" },
  { type: "ColumnValues", column: "v", is: { op: "=", value: 1 } },
  { type: "ColumnValues", column: "route", is: { op: "in", values: ROUTES } },
  // 100 to 599, as chapter 26's schema says.
  { type: "ColumnValues", column: "status", is: { op: "between", above: 99, below: 600 } },
  { type: "ColumnValues", column: "duration_ms", is: { op: ">=", value: 0 } },
];
// #endregion rules

// #region render
function quoted(text: string): string {
  if (text.includes('"') || text.includes("\n")) {
    throw new Error(`Cannot be written in a DQDL string: ${text}`);
  }
  return `"${text}"`;
}

function renderExpression(is: Expression): string {
  switch (is.op) {
    case "=":
    case ">=":
      return `${is.op} ${String(is.value)}`;
    case "between":
      return `between ${String(is.above)} and ${String(is.below)}`;
    case "in":
      return `in [${is.values.map(quoted).join(", ")}]`;
  }
}

export const renderRule = (rule: Rule): string =>
  rule.type === "ColumnValues"
    ? `ColumnValues ${quoted(rule.column)} ${renderExpression(rule.is)}`
    : `${rule.type} ${quoted(rule.column)}`;

/** The rules as a DQDL document, the text AWS Glue Data Quality reads. */
export const renderRuleset = (rules: readonly Rule[] = RULES): string =>
  `Rules = [\n${rules.map((rule) => `    ${renderRule(rule)}`).join(",\n")}\n]`;
// #endregion render

// #region evaluate
export type Row = Record<string, string | number | null>;
export type Outcome = { rule: string; outcome: "Passed" | "Failed" };

function holds(value: string | number | null, is: Expression): boolean {
  // For these four expressions the reference says a NULL fails the rule.
  if (value === null) {
    return false;
  }
  switch (is.op) {
    case "=":
      return value === is.value;
    case ">=":
      return typeof value === "number" && value >= is.value;
    case "between":
      return typeof value === "number" && value > is.above && value < is.below;
    case "in":
      return typeof value === "string" && is.values.includes(value);
  }
}

function passes(rule: Rule, rows: readonly Row[]): boolean {
  const values = rows.map((row) => row[rule.column] ?? null);
  switch (rule.type) {
    case "IsComplete":
      return values.every((value) => value !== null);
    case "IsUnique":
      return new Set(values).size === values.length;
    case "ColumnValues":
      return values.every((value) => holds(value, rule.is));
  }
}

/**
 * This chapter's reading of the DQDL reference for the rule forms above, so that
 * the rules can be tried on rows without Spark. It is not AWS Glue Data Quality.
 */
export const evaluate = (rules: readonly Rule[], rows: readonly Row[]): Outcome[] =>
  rules.map((rule) => ({
    rule: renderRule(rule),
    outcome: passes(rule, rows) ? "Passed" : "Failed",
  }));
// #endregion evaluate
