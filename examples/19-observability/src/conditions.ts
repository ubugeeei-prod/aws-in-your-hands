// #region condition
// One description of "which log lines", rendered for two CloudWatch features
// and evaluated here, so the tests can run it against real lines.
export type Condition = { field: string; op: "="; value: string | number } | { field: string; op: ">="; value: number };

const FIELD = /^[A-Za-z][A-Za-z0-9]*$/;
// Values end up inside a query string. Anything that could close the quotes is refused.
const TEXT = /^[A-Za-z0-9 ._:/-]*$/;

function literal(condition: Condition): string {
  if (!FIELD.test(condition.field)) {
    throw new Error(`Not a field name: ${condition.field}`);
  }
  if (typeof condition.value === "number") {
    if (!Number.isFinite(condition.value)) {
      throw new Error(`Not a finite number: ${condition.value}`);
    }
    return String(condition.value);
  }
  if (!TEXT.test(condition.value)) {
    throw new Error(`Not a safe value for a query: ${condition.value}`);
  }
  return `"${condition.value}"`;
}
// #endregion condition

// #region render
/** The argument of a Logs Insights `filter` command. */
export function insightsFilter(conditions: readonly Condition[]): string {
  return conditions.map((condition) => `${condition.field} ${condition.op} ${literal(condition)}`).join(" and ");
}

/** A metric filter pattern for log events that are JSON objects. */
export function metricFilterPattern(conditions: readonly Condition[]): string {
  const terms = conditions.map((condition) => `$.${condition.field} ${condition.op} ${literal(condition)}`);
  return terms.length === 1 ? `{ ${terms[0]} }` : `{ ${terms.map((term) => `(${term})`).join(" && ")} }`;
}
// #endregion render

// #region matches
export function matches(conditions: readonly Condition[], record: Record<string, unknown>): boolean {
  return conditions.every((condition) => {
    const actual = record[condition.field];
    if (condition.op === "=") {
      return actual === condition.value;
    }
    return typeof actual === "number" && actual >= condition.value;
  });
}
// #endregion matches
