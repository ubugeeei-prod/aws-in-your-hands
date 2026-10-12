// A MODEL of "full load plus change capture", written for this chapter from
// the documented behaviour. It is not AWS DMS. It copies tables one at a time,
// then applies a recorded change log in order, and keeps a checkpoint.

import * as v from "valibot";

import { type Queryable, rows, sqlStateOf } from "@aih/example-13-sql/src/db.ts";

import { type Table, type TableRef, qualified, quote } from "../catalog.ts";
import { type Change, currentLsn, readChanges } from "./capture.ts";

// #region types
export type Pair = { source: Table; target: TableRef };

export type Progress = {
  /** Per source table: the log position at which its copy began. Later changes are its to apply. */
  captureFrom: Record<string, number>;
  /** Every change up to here has been applied and recorded as applied. */
  checkpoint: number;
};

export type ApplyReport = {
  applied: number;
  /** An INSERT whose key was already there: left as it is, like ApplyErrorInsertPolicy LOG_ERROR. */
  insertConflicts: number;
  /** An UPDATE or DELETE that found no row. */
  missingRows: number;
  /** An UPDATE or DELETE on a table without a primary key: there is nothing to find the row by. */
  ignoredWithoutKey: number;
};

export type Hooks = {
  /** After capture has begun for this table, before its rows are read. */
  beforeRead?: (table: Table) => Promise<void>;
  /** After its rows were read from the source, before they reach the target. */
  afterRead?: (table: Table) => Promise<void>;
};
// #endregion types

const id = (table: TableRef): string => `${table.schema}.${table.name}`;
const anyRow = v.record(v.string(), v.unknown());

// PGlite hands jsonb back parsed; a parameter must be text again.
const parameter = (value: unknown): unknown =>
  value !== null && typeof value === "object" && !(value instanceof Date)
    ? JSON.stringify(value)
    : value;

async function insertRow(
  target: Queryable,
  table: TableRef,
  row: Record<string, unknown>,
): Promise<void> {
  const columns = Object.keys(row);
  await target.query(
    `INSERT INTO ${qualified(table)} (${columns.map(quote).join(", ")})
     VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
    columns.map((column) => parameter(row[column])),
  );
}

// #region full-load
/**
 * Copies each table whole, in the order given. Capture for a table starts just
 * before its rows are read, so a change made in between is both in the copy
 * and in the log: the apply step has to cope with seeing it twice.
 */
export async function fullLoad(
  source: Queryable,
  target: Queryable,
  pairs: Pair[],
  hooks: Hooks = {},
): Promise<Progress> {
  const captureFrom: Record<string, number> = {};
  // As the documented AfterConnectScript does: foreign keys and user triggers
  // stay quiet, because tables arrive one at a time and in no promised order.
  await target.query("SET session_replication_role = replica");
  try {
    for (const pair of pairs) {
      captureFrom[id(pair.source)] = await currentLsn(source);
      await hooks.beforeRead?.(pair.source);
      const copied = await rows(source, anyRow, `SELECT * FROM ${qualified(pair.source)}`);
      await hooks.afterRead?.(pair.source);
      for (const row of copied) {
        await insertRow(target, pair.target, row);
      }
    }
  } finally {
    await target.query("SET session_replication_role = origin");
  }
  return { captureFrom, checkpoint: 0 };
}
// #endregion full-load

function where(key: Record<string, unknown>, offset: number): { text: string; values: unknown[] } {
  const columns = Object.keys(key);
  return {
    text: columns.map((column, index) => `${quote(column)} = $${offset + index + 1}`).join(" AND "),
    values: columns.map((column) => parameter(key[column])),
  };
}

const countRow = v.object({ n: v.pipe(v.number(), v.integer()) });

async function affected(target: Queryable, text: string, values: unknown[]): Promise<number> {
  const [row] = await rows(
    target,
    countRow,
    `WITH changed AS (${text} RETURNING 1) SELECT count(*)::integer AS n FROM changed`,
    values,
  );
  return row?.n ?? 0;
}

// #region apply-one
async function applyOne(
  target: Queryable,
  table: TableRef,
  change: Change,
  report: ApplyReport,
): Promise<void> {
  if (change.op === "insert") {
    try {
      await insertRow(target, table, change.row ?? {});
    } catch (error) {
      // 23505 unique_violation: the copy already brought this row.
      if (sqlStateOf(error) !== "23505") {
        throw error;
      }
      report.insertConflicts++;
    }
    return;
  }
  if (change.key === null) {
    report.ignoredWithoutKey++;
    return;
  }
  const key = where(change.key, 0);
  if (change.op === "delete") {
    const deleted = await affected(
      target,
      `DELETE FROM ${qualified(table)} WHERE ${key.text}`,
      key.values,
    );
    report.missingRows += deleted === 0 ? 1 : 0;
    return;
  }
  const row = change.row ?? {};
  const columns = Object.keys(row);
  const filter = where(change.key, columns.length);
  const updated = await affected(
    target,
    `UPDATE ${qualified(table)}
        SET ${columns.map((column, index) => `${quote(column)} = $${index + 1}`).join(", ")}
      WHERE ${filter.text}`,
    [...columns.map((column) => parameter(row[column])), ...filter.values],
  );
  report.missingRows += updated === 0 ? 1 : 0;
}
// #endregion apply-one

// #region apply
export type ApplyOptions = {
  /** Record the checkpoint after this many changes. A crash loses what came after the last one. */
  checkpointEvery?: number;
  /** For tests: throws after this many changes were applied, before they are checkpointed. */
  crashAfter?: number;
};

/**
 * Applies the log after `progress.checkpoint`, oldest first, and moves the
 * checkpoint. Run it again with the same progress and it applies again what it
 * already applied: that is a resume, and the result has to be the same.
 */
export async function applyChanges(
  source: Queryable,
  target: Queryable,
  pairs: Pair[],
  progress: Progress,
  options: ApplyOptions = {},
): Promise<ApplyReport> {
  const report: ApplyReport = {
    applied: 0,
    insertConflicts: 0,
    missingRows: 0,
    ignoredWithoutKey: 0,
  };
  const targets = new Map(pairs.map((pair) => [id(pair.source), pair.target]));
  const every = options.checkpointEvery ?? 1;
  let last = progress.checkpoint;

  await target.query("SET session_replication_role = replica");
  try {
    for (const change of await readChanges(source, progress.checkpoint)) {
      const sourceId = `${change.schema}.${change.table}`;
      const table = targets.get(sourceId);
      // Not selected, or made before this table's copy began: the copy has it.
      if (table !== undefined && change.lsn > (progress.captureFrom[sourceId] ?? 0)) {
        await applyOne(target, table, change, report);
        report.applied++;
        if (options.crashAfter !== undefined && report.applied >= options.crashAfter) {
          throw new Error("model: the replication stopped before recording its checkpoint");
        }
      }
      last = change.lsn;
      if (change.lsn % every === 0) {
        progress.checkpoint = change.lsn;
      }
    }
    progress.checkpoint = last;
  } finally {
    await target.query("SET session_replication_role = origin");
  }
  return report;
}
// #endregion apply

/** How many recorded changes are not applied yet. The model's only notion of lag. */
export async function pendingChanges(source: Queryable, progress: Progress): Promise<number> {
  return (await readChanges(source, progress.checkpoint)).length;
}
