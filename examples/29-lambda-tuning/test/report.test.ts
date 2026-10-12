import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { billedMs } from "../src/cost-inputs.ts";
import { parseLine, parseLines, percentile, summarize } from "../src/report.ts";

// Lines copied from the Lambda Developer Guide. The file says from where.
const documented = readFileSync(new URL("../fixtures/report-lines.txt", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => line !== "");

describe("a REPORT line", () => {
  it("is read field by field, tabs or spaces between them", () => {
    const line =
      "REPORT RequestId: 3604209a-e9a3-11e6-939a-754dd98c7be3\tDuration: 12.34 ms\tBilled Duration: 100 ms Memory Size: 128 MB\tMax Memory Used: 18 MB";
    expect(parseLine(line)).toEqual({
      kind: "report",
      requestId: "3604209a-e9a3-11e6-939a-754dd98c7be3",
      durationMs: 12.34,
      billedDurationMs: 100,
      memorySizeMb: 128,
      maxMemoryUsedMb: 18,
    });
  });

  it("carries an init duration only on a cold start", () => {
    const reports = parseLines(documented).filter((line) => line.kind === "report");
    expect(reports.map((report) => report.initDurationMs)).toEqual([
      undefined,
      111.23,
      80,
      84,
      397.68,
    ]);
  });

  it("keeps the status and error type of a failed invocation", () => {
    const crashed = parseLine(
      "REPORT RequestId: 5b866fb1-7154-4af6-8078-6ef6ca4c2ddd Duration: 133.61 ms Billed Duration: 214 ms Memory Size: 128 MB Max Memory Used: 31 MB Init Duration: 80.00 ms Status: error Error Type: Runtime.ExitError",
    );
    expect(crashed).toMatchObject({ status: "error", errorType: "Runtime.ExitError" });
  });

  it("is refused when a field it must have is missing", () => {
    // A changed format must not turn into statistics about nothing.
    expect(() =>
      parseLine("REPORT RequestId: abc Duration: 1.00 ms Memory Size: 128 MB"),
    ).toThrow();
    expect(() =>
      parseLine(
        "REPORT RequestId: abc Duration: fast Billed Duration: 1 ms Memory Size: 128 MB Max Memory Used: 1 MB",
      ),
    ).toThrow();
  });
});

describe("the JSON log format", () => {
  it("reads platform.report and platform.initReport", () => {
    const [report, init] = parseLines(documented.filter((line) => line.startsWith("{")));
    expect(report).toMatchObject({
      kind: "report",
      durationMs: 693.92,
      billedDurationMs: 694,
      initDurationMs: 397.68,
      memorySizeMb: 128,
      maxMemoryUsedMb: 84,
    });
    expect(init).toEqual({
      kind: "init",
      durationMs: 125.33,
      phase: "init",
      initializationType: "on-demand",
      status: "success",
    });
  });

  it("passes over the application's own JSON lines", () => {
    const requestLine = JSON.stringify({
      level: "info",
      message: "request",
      requestId: "r-1",
      method: "GET",
      path: "/notes",
      status: 200,
      durationMs: 12,
    });
    expect(parseLine(requestLine)).toBeUndefined();
    expect(
      parseLine('{"time":"2026-10-13T00:00:00.000Z","type":"platform.start","record":{}}'),
    ).toBeUndefined();
    expect(parseLine("{ not json")).toBeUndefined();
  });

  it("refuses a platform.report without the metrics of a standard function", () => {
    expect(() =>
      parseLine('{"type":"platform.report","record":{"requestId":"r","metrics":{"durationMs":5}}}'),
    ).toThrow();
  });
});

describe("billed duration", () => {
  it("is handler time plus initialization, rounded up, in the guide's own lines", () => {
    const cold = parseLines(documented.filter((line) => line.startsWith("REPORT"))).flatMap(
      (line) => (line.kind === "report" && line.initDurationMs !== undefined ? [line] : []),
    );
    expect(cold).toHaveLength(3);
    for (const report of cold) {
      expect(billedMs(report.durationMs, report.initDurationMs)).toBe(report.billedDurationMs);
    }
    expect(billedMs(933.59)).toBe(934);
  });
});

describe("a summary", () => {
  const lines = parseLines([
    ...[40, 42, 44, 46, 48, 50, 52, 54, 56].map(
      (ms, index) =>
        `REPORT RequestId: warm-${index} Duration: ${ms}.00 ms Billed Duration: ${ms} ms Memory Size: 256 MB Max Memory Used: 90 MB`,
    ),
    "REPORT RequestId: cold-0 Duration: 120.00 ms Billed Duration: 420 ms Memory Size: 256 MB Max Memory Used: 96 MB Init Duration: 300.00 ms",
    "INIT_REPORT Init Duration: 500.00 ms Phase: init Status: timeout",
    "REPORT RequestId: late Duration: 10000.00 ms Billed Duration: 10000 ms Memory Size: 256 MB Max Memory Used: 96 MB Status: timeout",
  ]);
  const summary = summarize(lines);

  it("separates cold invocations from warm ones", () => {
    expect(summary.invocations).toBe(11);
    expect(summary.coldStarts).toBe(1);
    expect(summary.coldDurationMs).toEqual({ count: 1, p50: 120, p95: 120, max: 120 });
    // The timed-out invocation is warm, and it is the p95: one slow call in ten shows there.
    expect(summary.warmDurationMs).toEqual({ count: 10, p50: 48, p95: 10_000, max: 10_000 });
  });

  it("counts initialization reported on its own line too", () => {
    expect(summary.initDurationMs).toEqual({ count: 2, p50: 300, p95: 500, max: 500 });
  });

  it("adds up what was billed", () => {
    expect(summary.billedMs).toBe(432 + 420 + 10_000);
    expect(summary.billedGbSeconds).toBeCloseTo((10_852 / 1000) * 0.25, 9);
    expect(summary.memorySizeMb).toBe(256);
    expect(summary.maxMemoryUsedMb).toBe(96);
    expect(summary.failures).toBe(1);
  });

  it("says nothing about spreads it has no data for", () => {
    expect(summarize([])).toMatchObject({
      invocations: 0,
      warmDurationMs: undefined,
      coldDurationMs: undefined,
      initDurationMs: undefined,
      billedGbSeconds: 0,
    });
  });

  it("takes percentiles by nearest rank", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 95)).toBe(10);
    expect(percentile(sorted, 90)).toBe(9);
    expect(percentile([7], 95)).toBe(7);
  });
});
