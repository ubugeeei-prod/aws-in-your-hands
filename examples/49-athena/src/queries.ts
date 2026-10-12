import * as v from "valibot";

import { DATABASE, TABLE } from "@aih/example-26-analytics/src/names.ts";
import { addDays, daySchema } from "@aih/example-26-analytics/src/partition.ts";
import { partitionsFor } from "@aih/example-26-analytics/src/queries.ts";
import { COLUMNS, ROUTES } from "@aih/example-26-analytics/src/record.ts";

import { type Fragment, integer, list, sql, type Statement, text, trusted } from "./statement.ts";

// #region names
export const WORKGROUP = "aih-athena";
// Chapter 26's table of raw records, and the two tables this chapter derives from it.
export const SOURCE = `${DATABASE}.${TABLE}`;
export const COMPACT = `${DATABASE}.requests_compact`;
export const ICEBERG = `${DATABASE}.requests_iceberg`;
export const SCRATCH = `${DATABASE}.scratch_errors`;

const source = trusted(SOURCE);
const names = COLUMNS.map((column) => column.name);
const columns = list(names.map((name) => trusted(name)));
// #endregion names

// #region range
export type Range = { from: string; to: string };

/** The range as chapter 26 reads it: the folders one day wider, the moments exact. */
function bounds(range: Range) {
  const from = v.parse(daySchema, range.from);
  const to = v.parse(daySchema, range.to);
  if (from > to) {
    throw new Error(`The range ends before it starts: ${from} to ${to}`);
  }
  const partitions = partitionsFor({ from, to });
  return {
    firstFolder: text(partitions[0] as string),
    lastFolder: text(partitions.at(-1) as string),
    start: text(`${from}T00:00:00.000Z`),
    end: text(`${addDays(to, 1)}T00:00:00.000Z`),
  };
}
// #endregion range

// #region select
/** Answers per status for one route. Every value, the days included, is a parameter. */
export function requestsForRoute(input: Range & { route: string }): Statement {
  const { firstFolder, lastFolder, start, end } = bounds(input);
  return sql`SELECT status, count(DISTINCT event_id) AS requests
FROM ${source}
WHERE dt BETWEEN ${firstFolder} AND ${lastFolder}
  AND at >= ${start}
  AND at < ${end}
  AND route = ${text(input.route)}
GROUP BY status
ORDER BY status`;
}
// #endregion select

// #region unsafe
/**
 * The same query with the route pasted into the text. Here to be broken by a
 * test, and used nowhere else.
 */
export function unsafeRequestsForRoute(input: Range & { route: string }): string {
  return `SELECT status, count(DISTINCT event_id) AS requests
FROM ${SOURCE}
WHERE dt BETWEEN '${input.from}' AND '${input.to}'
  AND route = '${input.route}'
GROUP BY status
ORDER BY status`;
}

/** What a caller who trusts nothing still has to do before the query is built. */
export const routeSchema = v.picklist(ROUTES);
// #endregion unsafe

// #region compact
/** DDL takes no parameters. The location is text the stack wrote, not a value from outside. */
export function createCompactTable(location: Fragment): Statement {
  const definitions = list(
    COLUMNS.map((column) => trusted(`\`${column.name}\` ${column.type}`)),
    ",\n  ",
  );
  return sql`CREATE EXTERNAL TABLE IF NOT EXISTS ${trusted(COMPACT)} (
  ${definitions}
)
PARTITIONED BY (\`dt\` string)
STORED AS PARQUET
LOCATION '${location}'`;
}

/**
 * Copies the days into the Parquet table. INSERT INTO only adds files: running
 * it twice for the same days leaves every row there twice.
 */
export function compactDays(range: Range): Statement {
  const from = text(v.parse(daySchema, range.from));
  const to = text(v.parse(daySchema, range.to));
  // One row per event: a retried PutRecord can leave the same record in two days' folders.
  return sql`INSERT INTO ${trusted(COMPACT)}
SELECT ${columns}, min(dt) AS dt
FROM ${source}
WHERE dt BETWEEN ${from} AND ${to}
GROUP BY ${columns}`;
}
// #endregion compact

// #region scratch
/**
 * A table for an afternoon's digging. In a workgroup that enforces its result
 * location, Athena puts a CTAS table's files under that location, where the
 * results' expiry deletes them. Fine for this one; wrong for a table you keep.
 */
export function scratchErrors(range: Range): Statement {
  const { firstFolder, lastFolder, start, end } = bounds(range);
  return sql`CREATE TABLE ${trusted(SCRATCH)}
WITH (format = 'PARQUET') AS
SELECT ${columns}
FROM ${source}
WHERE dt BETWEEN ${firstFolder} AND ${lastFolder}
  AND at >= ${start}
  AND at < ${end}
  AND status >= ${integer(500)}`;
}
// #endregion scratch

// #region unload
const RUN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Writes the days as Parquet files and makes no table. The folder must be empty, so each run names its own. */
export function unloadDays(range: Range, exports: Fragment, run: string): Statement {
  if (!RUN.test(run)) {
    throw new Error(`Not a name for an export: ${run}`);
  }
  const { firstFolder, lastFolder, start, end } = bounds(range);
  return sql`UNLOAD (
  SELECT ${columns}
  FROM ${source}
  WHERE dt BETWEEN ${firstFolder} AND ${lastFolder}
    AND at >= ${start}
    AND at < ${end}
)
TO '${exports}${trusted(run)}/'
WITH (format = 'PARQUET')`;
}
// #endregion unload

// #region iceberg
/** An Iceberg table is not EXTERNAL: Athena owns its files and its history. */
export function createIcebergTable(location: Fragment): Statement {
  const definitions = list(
    [...COLUMNS, { name: "dt", type: "string" }].map((column) =>
      trusted(`\`${column.name}\` ${column.type}`),
    ),
    ",\n  ",
  );
  return sql`CREATE TABLE ${trusted(ICEBERG)} (
  ${definitions}
)
PARTITIONED BY (\`dt\`)
LOCATION '${location}'
TBLPROPERTIES ('table_type' = 'ICEBERG', 'format' = 'parquet')`;
}

/**
 * Adds the days' events the table does not hold yet. Running it again adds
 * nothing: an event already there is matched and left alone.
 */
export function mergeDays(range: Range): Statement {
  // MERGE accepts no parameters, so the two days go into the text. daySchema is the check.
  const from = v.parse(daySchema, range.from);
  const to = v.parse(daySchema, range.to);
  const inserted = list([...names, "dt"].map((name) => trusted(`s.${name}`)));
  return sql`MERGE INTO ${trusted(ICEBERG)} AS t
USING (
  SELECT ${columns}, min(dt) AS dt
  FROM ${source}
  WHERE dt BETWEEN '${trusted(from)}' AND '${trusted(to)}'
  GROUP BY ${columns}
) AS s
ON t.event_id = s.event_id
WHEN NOT MATCHED
  THEN INSERT (${columns}, dt) VALUES (${inserted})`;
}

/** Rewrites small files and applied deletes into larger files. Billed by the bytes it reads. */
export function optimizeDays(range: Range): Statement {
  const from = v.parse(daySchema, range.from);
  const to = v.parse(daySchema, range.to);
  // Only partition columns may appear here.
  return sql`OPTIMIZE ${trusted(ICEBERG)} REWRITE DATA USING BIN_PACK
WHERE dt BETWEEN '${trusted(from)}' AND '${trusted(to)}'`;
}

/** Expires old snapshots and deletes files nothing refers to. Time travel past them ends here. */
export const vacuum = (): Statement => sql`VACUUM ${trusted(ICEBERG)}`;

/** The table as it was a day ago, next to nothing else: how many events each day held then. */
export const eventsPerDayYesterday = (): Statement =>
  sql`SELECT dt, count(*) AS events
FROM ${trusted(ICEBERG)} FOR TIMESTAMP AS OF (current_timestamp - interval '1' day)
GROUP BY dt
ORDER BY dt`;
// #endregion iceberg
