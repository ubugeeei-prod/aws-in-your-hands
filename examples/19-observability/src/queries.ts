import { z } from "zod";
import { type Condition, insightsFilter, matches } from "./conditions.ts";

// #region model
export type Query = {
  where: Condition[];
  /** List matching lines, or count them per group. */
  show: { kind: "fields"; fields: string[] } | { kind: "count"; by: string[] };
  /** `@timestamp` means "in the order the lines were written". */
  sort: { field: string; order: "asc" | "desc" };
  limit: number;
};

const COUNT = "requests";

export function renderInsights(query: Query): string {
  const show =
    query.show.kind === "fields"
      ? `fields @timestamp, ${query.show.fields.join(", ")}`
      : `stats count(*) as ${COUNT} by ${query.show.by.join(", ")}`;
  return [
    // filter first, so later commands work on fewer events
    `filter ${insightsFilter(query.where)}`,
    show,
    `sort ${query.sort.field} ${query.sort.order}`,
    `limit ${query.limit}`,
  ].join("\n| ");
}
// #endregion model

// #region queries
const requestIdSchema = z.uuid();
const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
const requestFields = ["level", "message", "method", "path", "status", "durationMs", "traceId", "sampled", "error"];

/** Everything one request wrote, oldest first. The ID is the `x-request-id` response header. */
export function byRequestId(requestId: string): Query {
  return {
    where: [{ field: "requestId", op: "=", value: requestIdSchema.parse(requestId) }],
    show: { kind: "fields", fields: requestFields },
    sort: { field: "@timestamp", order: "asc" },
    limit: 100,
  };
}

/** From a trace to its log lines. Takes the 32-character form, not X-Ray's `1-…-…`. */
export function byTraceId(traceId: string): Query {
  return {
    where: [{ field: "traceId", op: "=", value: traceIdSchema.parse(traceId) }],
    show: { kind: "fields", fields: ["requestId", ...requestFields] },
    sort: { field: "@timestamp", order: "asc" },
    limit: 100,
  };
}

/** Which routes fail. */
export function serverErrorsByRoute(): Query {
  return {
    where: [
      { field: "message", op: "=", value: "request" },
      { field: "status", op: ">=", value: 500 },
    ],
    show: { kind: "count", by: ["method", "path"] },
    sort: { field: COUNT, order: "desc" },
    limit: 20,
  };
}

/** The slowest requests at or above a duration. */
export function slowRequests(thresholdMs: number): Query {
  return {
    where: [
      { field: "message", op: "=", value: "request" },
      { field: "durationMs", op: ">=", value: thresholdMs },
    ],
    show: { kind: "fields", fields: ["requestId", "method", "path", "status", "durationMs", "traceId"] },
    sort: { field: "durationMs", order: "desc" },
    limit: 20,
  };
}
// #endregion queries

// #region conflicts
/** Updates refused because someone else saved first. The metric filter counts these lines. */
export const conflictLines: Condition[] = [
  { field: "message", op: "=", value: "request" },
  { field: "status", op: "=", value: 409 },
];
// #endregion conflicts

// #region run
type Row = Record<string, unknown>;

function compare(a: unknown, b: unknown): number {
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
}

/**
 * What the query selects from lines held in memory. It follows the model
 * above, not the Logs Insights engine: the rendered text is what AWS runs.
 */
export function runLocally(query: Query, lines: readonly Row[]): Row[] {
  const selected = lines.filter((line) => matches(query.where, line));
  let rows: Row[];
  if (query.show.kind === "fields") {
    const fields = query.show.fields;
    rows = selected.map((line) => Object.fromEntries(fields.filter((f) => f in line).map((f) => [f, line[f]])));
  } else {
    const by = query.show.by;
    const groups = new Map<string, Row>();
    for (const line of selected) {
      const key = JSON.stringify(by.map((field) => line[field]));
      const group = groups.get(key) ?? { ...Object.fromEntries(by.map((field) => [field, line[field]])), [COUNT]: 0 };
      group[COUNT] = (group[COUNT] as number) + 1;
      groups.set(key, group);
    }
    rows = [...groups.values()];
  }
  if (query.sort.field !== "@timestamp") {
    const direction = query.sort.order === "asc" ? 1 : -1;
    const field = query.sort.field;
    rows = rows.toSorted((a, b) => direction * compare(a[field], b[field]));
  } else if (query.sort.order === "desc") {
    rows = rows.toReversed();
  }
  return rows.slice(0, query.limit);
}
// #endregion run
