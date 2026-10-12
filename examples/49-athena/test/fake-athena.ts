// A stand-in for Athena's query API, written for these tests from the API reference.
// It models exactly this, and nothing else of the service:
// - StartQueryExecution with a ClientRequestToken it has seen returns the same
//   QueryExecutionId and starts nothing; with a changed QueryString it is an error
// - a query moves through the states it was scripted with, one per GetQueryExecution
// - GetQueryResults pages with NextToken, and the first row of the first page
//   repeats the column names
// - StopQueryExecution makes a query that is still going CANCELLED

import type { AthenaApi, StartInput } from "../src/client.ts";

type State = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export type Script = {
  /** States that successive GetQueryExecution calls report. The last one repeats. */
  states: State[];
  columns?: string[];
  rows?: (string | null)[][];
  pageSize?: number;
  scannedBytes?: number;
  reused?: boolean;
  reason?: string;
};

type Execution = { id: string; input: StartInput; script: Script; polls: number; stopped: boolean };

export function fakeAthena(script: Script) {
  const executions: Execution[] = [];
  const byToken = new Map<string, Execution>();
  const calls = { start: 0, get: 0, results: 0, stop: 0 };
  // Faults to inject: the next start is carried out but its response never arrives; stop is refused.
  const faults = { loseNextStartResponse: false, refuseStop: false };

  const find = (id: string): Execution => {
    const execution = executions.find((each) => each.id === id);
    if (execution === undefined) {
      throw new Error(`fake: no query ${id}`);
    }
    return execution;
  };
  const stateOf = (execution: Execution): State => {
    if (execution.stopped) {
      return "CANCELLED";
    }
    const { states } = execution.script;
    return states[Math.min(execution.polls, states.length - 1)] as State;
  };

  const api: AthenaApi = {
    start: async (input) => {
      calls.start += 1;
      let execution = byToken.get(input.ClientRequestToken);
      if (execution === undefined) {
        execution = {
          id: `query-${executions.length + 1}`,
          input,
          script,
          polls: 0,
          stopped: false,
        };
        executions.push(execution);
        byToken.set(input.ClientRequestToken, execution);
      } else if (execution.input.QueryString !== input.QueryString) {
        throw new Error("fake: this token was used with another query");
      }
      if (faults.loseNextStartResponse) {
        faults.loseNextStartResponse = false;
        throw new Error("socket hang up");
      }
      return { QueryExecutionId: execution.id };
    },

    get: async (id) => {
      calls.get += 1;
      const execution = find(id);
      const state = stateOf(execution);
      execution.polls += 1;
      return {
        QueryExecution: {
          QueryExecutionId: id,
          Status: {
            State: state,
            ...(execution.script.reason !== undefined && {
              StateChangeReason: execution.script.reason,
            }),
          },
          Statistics: {
            ...(execution.script.scannedBytes !== undefined && {
              DataScannedInBytes: execution.script.scannedBytes,
            }),
            ResultReuseInformation: { ReusedPreviousResult: execution.script.reused ?? false },
          },
        },
      };
    },

    results: async (id, nextToken) => {
      calls.results += 1;
      const { columns = [], rows = [], pageSize = 1000 } = find(id).script;
      const all = [columns, ...rows];
      const from = nextToken === undefined ? 0 : Number(nextToken);
      const to = from + pageSize;
      return {
        ResultSet: {
          Rows: all.slice(from, to).map((row) => ({
            // A NULL cell arrives as an object without VarCharValue.
            Data: row.map((cell) => (cell === null ? {} : { VarCharValue: cell })),
          })),
          ResultSetMetadata: { ColumnInfo: columns.map((Name) => ({ Name, Type: "varchar" })) },
        },
        ...(to < all.length && { NextToken: String(to) }),
      };
    },

    stop: async (id) => {
      calls.stop += 1;
      if (faults.refuseStop) {
        throw new Error("fake: stop refused");
      }
      find(id).stopped = true;
      return {};
    },
  };

  return { api, calls, faults, executions };
}
