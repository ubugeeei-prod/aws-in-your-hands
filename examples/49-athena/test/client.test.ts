import { describe, expect, it } from "vite-plus/test";

import { requestToken, type RunOptions, runQuery } from "../src/client.ts";
import { requestsForRoute } from "../src/queries.ts";
import { fakeAthena } from "./fake-athena.ts";

const statement = requestsForRoute({ from: "2026-10-12", to: "2026-10-12", route: "/notes" });

/** A clock that only moves when the client sleeps, so every wait is exact. */
function harness(overrides: Partial<RunOptions> = {}) {
  let time = 0;
  const sleeps: number[] = [];
  const options: RunOptions = {
    workGroup: "aih-athena",
    database: "aih_analytics",
    attempt: "attempt-1",
    maxWaitMs: 10_000,
    maxRows: 100,
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    ...overrides,
  };
  return { options, sleeps };
}

describe("starting a query", () => {
  it("sends the text and the values apart, in the workgroup, with a token", async () => {
    const athena = fakeAthena({ states: ["SUCCEEDED"], columns: ["status", "requests"] });
    await runQuery(athena.api, statement, harness().options);
    expect(athena.executions[0]?.input).toEqual({
      QueryString: statement.sql,
      ExecutionParameters: [...statement.parameters],
      WorkGroup: "aih-athena",
      QueryExecutionContext: { Database: "aih_analytics" },
      ClientRequestToken: requestToken(statement, "attempt-1"),
    });
    expect(requestToken(statement, "attempt-1")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("asks for a stored result only when the caller gives an age", async () => {
    const athena = fakeAthena({ states: ["SUCCEEDED"], columns: ["status"], reused: true });
    const outcome = await runQuery(athena.api, statement, harness({ reuseMinutes: 30 }).options);
    expect(athena.executions[0]?.input.ResultReuseConfiguration).toEqual({
      ResultReuseByAgeConfiguration: { Enabled: true, MaxAgeInMinutes: 30 },
    });
    expect(outcome).toMatchObject({ state: "SUCCEEDED", reused: true });
  });

  it("starts one query when the first answer is lost and the same attempt is sent again", async () => {
    const athena = fakeAthena({ states: ["SUCCEEDED"], columns: ["status"] });
    athena.faults.loseNextStartResponse = true;
    const { options } = harness();
    await expect(runQuery(athena.api, statement, options)).rejects.toThrow("socket hang up");

    const outcome = await runQuery(athena.api, statement, options);
    expect(athena.calls.start).toBe(2);
    expect(athena.executions).toHaveLength(1);
    expect(outcome).toMatchObject({ state: "SUCCEEDED", id: "query-1" });
  });

  it("starts a second query when the attempt is named anew: that is how to run it again", async () => {
    const athena = fakeAthena({ states: ["SUCCEEDED"], columns: ["status"] });
    await runQuery(athena.api, statement, harness().options);
    await runQuery(athena.api, statement, harness({ attempt: "attempt-2" }).options);
    expect(athena.executions.map((execution) => execution.id)).toEqual(["query-1", "query-2"]);
  });
});

describe("waiting for a query", () => {
  it("polls with waits that double up to two seconds, and returns typed rows", async () => {
    const athena = fakeAthena({
      states: ["QUEUED", "RUNNING", "RUNNING", "RUNNING", "RUNNING", "SUCCEEDED"],
      columns: ["status", "requests"],
      rows: [
        ["200", "41"],
        ["404", null],
      ],
      scannedBytes: 2_345_678,
    });
    const { options, sleeps } = harness();
    const outcome = await runQuery(athena.api, statement, options);
    expect(sleeps).toEqual([250, 500, 1000, 2000, 2000]);
    expect(outcome).toEqual({
      state: "SUCCEEDED",
      id: "query-1",
      columns: ["status", "requests"],
      rows: [
        { status: "200", requests: "41" },
        { status: "404", requests: null },
      ],
      truncated: false,
      scannedBytes: 2_345_678,
      reused: false,
    });
  });

  it("follows a query that goes back to QUEUED, as the API says a retried one does", async () => {
    const athena = fakeAthena({
      states: ["RUNNING", "QUEUED", "RUNNING", "SUCCEEDED"],
      columns: ["status"],
    });
    expect(await runQuery(athena.api, statement, harness().options)).toMatchObject({
      state: "SUCCEEDED",
    });
  });

  it("reports a failure and a cancellation with the reason and what was scanned", async () => {
    const failed = fakeAthena({ states: ["RUNNING", "FAILED"], reason: "fixture: a syntax error" });
    expect(await runQuery(failed.api, statement, harness().options)).toEqual({
      state: "FAILED",
      id: "query-1",
      reason: "fixture: a syntax error",
      scannedBytes: undefined,
    });

    const cancelled = fakeAthena({
      states: ["RUNNING", "CANCELLED"],
      reason: "fixture: over the scan limit",
      scannedBytes: 1_073_741_824,
    });
    expect(await runQuery(cancelled.api, statement, harness().options)).toMatchObject({
      state: "CANCELLED",
      scannedBytes: 1_073_741_824,
    });
    expect(failed.calls.results + cancelled.calls.results).toBe(0);
  });
});

describe("giving up on a query", () => {
  it("stops the query when the wait runs out, and never waits past the deadline", async () => {
    const athena = fakeAthena({ states: ["RUNNING"] });
    const { options, sleeps } = harness({ maxWaitMs: 3000 });
    const outcome = await runQuery(athena.api, statement, options);
    expect(outcome).toEqual({ state: "TIMED_OUT", id: "query-1", stopped: true });
    expect(athena.executions[0]?.stopped).toBe(true);
    // 250 + 500 + 1000 + the 1250 that was left, not the 2000 the schedule asked for.
    expect(sleeps).toEqual([250, 500, 1000, 1250]);
  });

  it("says so when the query could not be stopped: it is still running, and still billed", async () => {
    const athena = fakeAthena({ states: ["RUNNING"] });
    athena.faults.refuseStop = true;
    const outcome = await runQuery(athena.api, statement, harness({ maxWaitMs: 1000 }).options);
    expect(outcome).toEqual({ state: "TIMED_OUT", id: "query-1", stopped: false });
    expect(athena.executions[0]?.stopped).toBe(false);
  });
});

describe("reading results", () => {
  const rows = Array.from({ length: 7 }, (_, index) => [String(index)]);

  it("follows NextToken across pages and drops the header row once", async () => {
    const athena = fakeAthena({ states: ["SUCCEEDED"], columns: ["n"], rows, pageSize: 3 });
    const outcome = await runQuery(athena.api, statement, harness().options);
    expect(athena.calls.results).toBe(3);
    expect(outcome).toMatchObject({ truncated: false });
    expect(outcome.state === "SUCCEEDED" && outcome.rows.map((row) => row["n"])).toEqual(
      rows.map(([n]) => n),
    );
  });

  it("stops at maxRows, says the rows were cut, and fetches no further page", async () => {
    const athena = fakeAthena({ states: ["SUCCEEDED"], columns: ["n"], rows, pageSize: 3 });
    const outcome = await runQuery(athena.api, statement, harness({ maxRows: 4 }).options);
    expect(outcome).toMatchObject({ truncated: true });
    expect(outcome.state === "SUCCEEDED" && outcome.rows).toHaveLength(4);
    expect(athena.calls.results).toBe(2);
  });

  it("refuses a response that is not shaped like the API reference", async () => {
    const athena = fakeAthena({ states: ["SUCCEEDED"] });
    const broken = {
      ...athena.api,
      get: async () => ({ QueryExecution: { Status: { State: "DONE" } } }),
    };
    await expect(runQuery(broken, statement, harness().options)).rejects.toThrow();
  });
});
