import { createHash } from "node:crypto";

import * as v from "valibot";

import type { Statement } from "./statement.ts";

// #region api
/** The four Athena operations a query needs. The SDK adapter and the test fake both have this shape. */
export type AthenaApi = {
  start(input: StartInput): Promise<unknown>;
  get(queryExecutionId: string): Promise<unknown>;
  results(queryExecutionId: string, nextToken: string | undefined): Promise<unknown>;
  stop(queryExecutionId: string): Promise<unknown>;
};

export type StartInput = {
  QueryString: string;
  ExecutionParameters?: string[];
  WorkGroup: string;
  QueryExecutionContext?: { Database: string };
  ClientRequestToken: string;
  ResultReuseConfiguration?: {
    ResultReuseByAgeConfiguration: { Enabled: boolean; MaxAgeInMinutes?: number };
  };
};
// #endregion api

// #region schemas
const startedSchema = v.object({ QueryExecutionId: v.pipe(v.string(), v.minLength(1)) });

const STATES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
const executionSchema = v.object({
  QueryExecution: v.object({
    Status: v.object({
      State: v.picklist(STATES),
      StateChangeReason: v.optional(v.string()),
    }),
    Statistics: v.optional(
      v.object({
        DataScannedInBytes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
        ResultReuseInformation: v.optional(v.object({ ReusedPreviousResult: v.boolean() })),
      }),
    ),
  }),
});

const resultsSchema = v.object({
  ResultSet: v.object({
    Rows: v.optional(
      v.array(
        v.object({
          Data: v.optional(v.array(v.object({ VarCharValue: v.optional(v.string()) })), []),
        }),
      ),
      [],
    ),
    ResultSetMetadata: v.object({
      ColumnInfo: v.array(v.object({ Name: v.string(), Type: v.string() })),
    }),
  }),
  NextToken: v.optional(v.string()),
});
// #endregion schemas

// #region token
/**
 * The same statement in the same attempt gets the same token, so that a start
 * sent twice starts one query. Athena wants 32 to 128 characters.
 */
export function requestToken(statement: Statement, attempt: string): string {
  return createHash("sha256")
    .update(JSON.stringify([statement.sql, statement.parameters, attempt]))
    .digest("hex");
}
// #endregion token

// #region outcome
export type Row = Record<string, string | null>;

export type Outcome =
  | {
      state: "SUCCEEDED";
      id: string;
      columns: string[];
      rows: Row[];
      /** True when maxRows cut the rows short. The full result is still in the result location. */
      truncated: boolean;
      scannedBytes: number | undefined;
      reused: boolean;
    }
  | { state: "FAILED" | "CANCELLED"; id: string; reason: string; scannedBytes: number | undefined }
  // The wait ran out. `stopped` says whether Athena accepted the request to stop the query.
  | { state: "TIMED_OUT"; id: string; stopped: boolean };

export type RunOptions = {
  workGroup: string;
  database?: string;
  /** Names this attempt. Reuse it to retry the same attempt, change it to run the query again. */
  attempt: string;
  /** Accept a stored result up to this old. Left out, the query always runs. */
  reuseMinutes?: number;
  maxWaitMs: number;
  maxRows: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};
// #endregion outcome

// #region run
// Waits between polls, doubling up to two seconds. Chosen, not measured.
const FIRST_POLL_MS = 250;
const LONGEST_POLL_MS = 2000;

export async function runQuery(
  api: AthenaApi,
  statement: Statement,
  options: RunOptions,
): Promise<Outcome> {
  const { QueryExecutionId: id } = v.parse(
    startedSchema,
    await api.start({
      QueryString: statement.sql,
      // The API refuses an empty list.
      ...(statement.parameters.length > 0 && { ExecutionParameters: [...statement.parameters] }),
      WorkGroup: options.workGroup,
      ...(options.database !== undefined && {
        QueryExecutionContext: { Database: options.database },
      }),
      ClientRequestToken: requestToken(statement, options.attempt),
      ...(options.reuseMinutes !== undefined && {
        ResultReuseConfiguration: {
          ResultReuseByAgeConfiguration: { Enabled: true, MaxAgeInMinutes: options.reuseMinutes },
        },
      }),
    }),
  );

  const deadline = options.now() + options.maxWaitMs;
  for (let wait = FIRST_POLL_MS; ; wait = Math.min(wait * 2, LONGEST_POLL_MS)) {
    const { Status: status, Statistics: statistics } = v.parse(
      executionSchema,
      await api.get(id),
    ).QueryExecution;
    const scannedBytes = statistics?.DataScannedInBytes;

    if (status.State === "SUCCEEDED") {
      const page = await readRows(api, id, options.maxRows);
      return {
        state: "SUCCEEDED",
        id,
        ...page,
        scannedBytes,
        reused: statistics?.ResultReuseInformation?.ReusedPreviousResult ?? false,
      };
    }
    if (status.State === "FAILED" || status.State === "CANCELLED") {
      return {
        state: status.State,
        id,
        reason: status.StateChangeReason ?? "no reason given",
        scannedBytes,
      };
    }

    const remaining = deadline - options.now();
    if (remaining <= 0) {
      // Giving up on the wait does not end the query. It would go on reading, and billing.
      const stopped = await api.stop(id).then(
        () => true,
        () => false,
      );
      return { state: "TIMED_OUT", id, stopped };
    }
    await options.sleep(Math.min(wait, remaining));
  }
}
// #endregion run

// #region rows
async function readRows(
  api: AthenaApi,
  id: string,
  maxRows: number,
): Promise<{ columns: string[]; rows: Row[]; truncated: boolean }> {
  let columns: string[] = [];
  const rows: Row[] = [];
  let nextToken: string | undefined;
  let first = true;
  do {
    const page = v.parse(resultsSchema, await api.results(id, nextToken));
    columns = page.ResultSet.ResultSetMetadata.ColumnInfo.map((column) => column.Name);
    let cells = page.ResultSet.Rows.map((row) => row.Data.map((cell) => cell.VarCharValue ?? null));
    // For a SELECT the first row of the first page repeats the column names. Dropped only when it does.
    if (first && cells[0]?.every((cell, index) => cell === columns[index]) === true) {
      cells = cells.slice(1);
    }
    first = false;
    for (const row of cells) {
      if (rows.length === maxRows) {
        return { columns, rows, truncated: true };
      }
      rows.push(Object.fromEntries(columns.map((name, index) => [name, row[index] ?? null])));
    }
    nextToken = page.NextToken;
  } while (nextToken !== undefined);
  return { columns, rows, truncated: false };
}
// #endregion rows
