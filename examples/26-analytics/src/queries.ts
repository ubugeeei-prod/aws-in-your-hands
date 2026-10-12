import * as v from "valibot";

import { type LakeObject, scanPartitions } from "./lake.ts";
import { addDays, daysBetween, daySchema } from "./partition.ts";
import { type Column, COLUMNS, type RequestRecord } from "./record.ts";

// #region model
export type Predicate =
  | { column: Column; op: "=" | ">="; value: string | number }
  | { column: Column; op: "is not null" };

export type Measure =
  // Rows with the same event_id count once: a producer's retry can write a record twice.
  | { kind: "distinct"; as: string }
  // Every row, copies included. Needs no column at all, which a columnar file rewards.
  | { kind: "rows"; as: string }
  | { kind: "p95"; column: "duration_ms"; as: string };

/** `day` is the UTC day of `at`: when it happened, not which folder it is filed in. */
export type Dimension = Column | "day";

export type Query = {
  /** Days the requests were answered on, in UTC, both included. */
  from: string;
  to: string;
  where: Predicate[];
  by: Dimension[];
  measures: Measure[];
};
// #endregion model

// #region partitions
/**
 * The partitions a query must read. One day more on each side: an object is
 * filed under the day its oldest record arrived, so a record from just after
 * midnight can sit in yesterday's folder, and a late one in tomorrow's.
 */
export function partitionsFor(query: Pick<Query, "from" | "to">): string[] {
  return daysBetween(addDays(query.from, -1), addDays(query.to, 1));
}
// #endregion partitions

// #region render
const NAMES = new Set<string>(COLUMNS.map((column) => column.name));
const ALIAS = /^[a-z][a-z0-9_]*$/;
// Values end up inside a SQL string. Anything that could close the quotes is refused.
const TEXT = /^[A-Za-z0-9 ._:/-]*$/;

function column(name: string): string {
  if (!NAMES.has(name)) {
    throw new Error(`Not a column: ${name}`);
  }
  return name;
}

function literal(value: string | number): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Not a finite number: ${value}`);
    }
    return String(value);
  }
  if (!TEXT.test(value)) {
    throw new Error(`Not a safe value for a query: ${value}`);
  }
  return `'${value}'`;
}

const alias = (name: string): string => {
  if (!ALIAS.test(name) || NAMES.has(name) || name === "day") {
    throw new Error(`Not a name for a result column: ${name}`);
  }
  return name;
};

const dimension = (name: Dimension): string =>
  name === "day" ? "substr(at, 1, 10)" : column(name);

/** The SQL Athena runs. `table` is `"database"."table"`, taken from the stack. */
export function renderAthena(query: Query, table: string): string {
  const from = v.parse(daySchema, query.from);
  const to = v.parse(daySchema, query.to);
  if (from > to) {
    throw new Error(`The range ends before it starts: ${from} to ${to}`);
  }
  const partitions = partitionsFor(query);
  const where = [
    // First, and always: the only condition that keeps Athena from reading every day there is.
    `dt BETWEEN '${partitions[0]}' AND '${partitions.at(-1)}'`,
    `at >= '${from}T00:00:00.000Z'`,
    `at < '${addDays(to, 1)}T00:00:00.000Z'`,
    ...query.where.map((predicate) =>
      predicate.op === "is not null"
        ? `${column(predicate.column)} IS NOT NULL`
        : `${column(predicate.column)} ${predicate.op} ${literal(predicate.value)}`,
    ),
  ];
  const select = [
    ...query.by.map((name) => (name === "day" ? `${dimension(name)} AS day` : column(name))),
    ...query.measures.map((measure) =>
      measure.kind === "distinct"
        ? `count(DISTINCT event_id) AS ${alias(measure.as)}`
        : measure.kind === "rows"
          ? `count(*) AS ${alias(measure.as)}`
          : `approx_percentile(${column(measure.column)}, 0.95) AS ${alias(measure.as)}`,
    ),
  ];
  return [
    `SELECT ${select.join(", ")}`,
    `FROM ${table}`,
    `WHERE ${where.join("\n  AND ")}`,
    `GROUP BY ${query.by.map(dimension).join(", ")}`,
    `ORDER BY ${query.by.join(", ")}`,
  ].join("\n");
}
// #endregion render

// #region queries
/** What happened to notes, per day. */
export function actionsPerDay(from: string, to: string): Query {
  return {
    from,
    to,
    where: [{ column: "action", op: "is not null" }],
    by: ["day", "action"],
    measures: [{ kind: "distinct", as: "events" }],
  };
}

/** How often each route is called, and how long the slow ones take. */
export function requestsPerRoute(from: string, to: string): Query {
  return {
    from,
    to,
    where: [],
    by: ["method", "route"],
    measures: [
      { kind: "distinct", as: "requests" },
      { kind: "p95", column: "duration_ms", as: "p95_ms" },
    ],
  };
}

/** Requests the app failed to answer, per day and route. */
export function errorsPerDay(from: string, to: string): Query {
  return {
    from,
    to,
    where: [{ column: "status", op: ">=", value: 500 }],
    by: ["day", "route"],
    measures: [{ kind: "distinct", as: "errors" }],
  };
}

/** Answers per day and status, counted without removing copies: a rough but cheap count. */
export function statusPerDay(from: string, to: string): Query {
  return {
    from,
    to,
    where: [],
    by: ["day", "status"],
    measures: [{ kind: "rows", as: "answers" }],
  };
}
// #endregion queries

// #region run
type Row = Record<string, string | number | null>;

const valueOf = (record: RequestRecord, name: Dimension): string | number | null =>
  name === "day" ? record.at.slice(0, 10) : record[name];

function holds(predicate: Predicate, record: RequestRecord): boolean {
  const actual = record[predicate.column];
  if (predicate.op === "is not null") {
    return actual !== null;
  }
  if (predicate.op === "=") {
    return actual === predicate.value;
  }
  return typeof actual === "number" && typeof predicate.value === "number"
    ? actual >= predicate.value
    : false;
}

/** Nearest rank. Athena's approx_percentile is an approximation of this, not the same number. */
function percentile95(values: number[]): number | null {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
}

function compare(a: string | number | null | undefined, b: typeof a): number {
  return typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b));
}

export type LocalResult = { rows: Row[]; partitions: string[]; objects: number; bytes: number };

/**
 * What the query selects from objects on this machine. It follows the model
 * above, not Athena's engine: the rendered SQL is what AWS runs, and no SQL is
 * executed here.
 */
export function runLocally(query: Query, objects: readonly LakeObject[]): LocalResult {
  const scan = scanPartitions(objects, partitionsFor(query));
  const start = `${query.from}T00:00:00.000Z`;
  const end = `${addDays(query.to, 1)}T00:00:00.000Z`;
  const selected = scan.records.filter(
    (record) =>
      record.at >= start &&
      record.at < end &&
      query.where.every((predicate) => holds(predicate, record)),
  );

  const groups = new Map<string, RequestRecord[]>();
  for (const record of selected) {
    const key = JSON.stringify(query.by.map((name) => valueOf(record, name)));
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const rows = [...groups.values()].map((records) => {
    const first = records[0] as RequestRecord;
    const row: Row = Object.fromEntries(query.by.map((name) => [name, valueOf(first, name)]));
    for (const measure of query.measures) {
      row[measure.as] =
        measure.kind === "distinct"
          ? new Set(records.map((record) => record.event_id)).size
          : measure.kind === "rows"
            ? records.length
            : percentile95(records.map((record) => record[measure.column]));
    }
    return row;
  });
  rows.sort((a, b) => {
    for (const name of query.by) {
      const order = compare(a[name], b[name]);
      if (order !== 0) {
        return order;
      }
    }
    return 0;
  });
  return { rows, partitions: scan.partitions, objects: scan.objects, bytes: scan.bytes };
}
// #endregion run
