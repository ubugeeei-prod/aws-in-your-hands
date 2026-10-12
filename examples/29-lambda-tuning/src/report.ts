// Lambda writes one report per invocation. This file reads both of its forms: the plain
// text REPORT line and the `platform.report` object of the JSON log format.

import * as v from "valibot";

// #region shape
const milliseconds = v.pipe(v.number(), v.finite(), v.minValue(0));
const megabytes = v.pipe(v.number(), v.integer(), v.minValue(0));
const status = v.picklist(["success", "failure", "error", "timeout"]);

export const reportSchema = v.object({
  requestId: v.pipe(v.string(), v.minLength(1)),
  /** Time in the handler. No initialization in it. */
  durationMs: milliseconds,
  /** What the invocation is charged for. */
  billedDurationMs: milliseconds,
  memorySizeMb: megabytes,
  maxMemoryUsedMb: megabytes,
  /** Present only when this invocation initialized the environment: a cold start. */
  initDurationMs: v.optional(milliseconds),
  status: v.optional(status),
  errorType: v.optional(v.string()),
});
export type Report = v.InferOutput<typeof reportSchema>;

export const initReportSchema = v.object({
  durationMs: milliseconds,
  /** `invoke` is a re-initialization after a failed invocation. */
  phase: v.picklist(["init", "invoke", "snap-start"]),
  initializationType: v.optional(v.picklist(["on-demand", "provisioned-concurrency"])),
  status: v.optional(status),
  errorType: v.optional(v.string()),
});
export type InitReport = v.InferOutput<typeof initReportSchema>;

export type Line = ({ kind: "report" } & Report) | ({ kind: "init" } & InitReport);
// #endregion shape

// #region text
// Longest label first: "Billed Duration" must not be read as "Duration".
const LABEL =
  /(Billed Duration|Init Duration|Max Memory Used|Memory Size|Error Type|RequestId|Duration|Status|Phase): (\S+)/g;

function fields(line: string): Map<string, string> {
  return new Map([...line.matchAll(LABEL)].map((match) => [match[1] ?? "", match[2] ?? ""]));
}

// "12.34" becomes a number and "fast" becomes NaN, which v.number() refuses.
const number = (text: string | undefined) => (text === undefined ? undefined : Number(text));

function fromText(line: string): Line | undefined {
  if (line.startsWith("REPORT ")) {
    const found = fields(line);
    return {
      kind: "report",
      ...v.parse(reportSchema, {
        requestId: found.get("RequestId"),
        durationMs: number(found.get("Duration")),
        billedDurationMs: number(found.get("Billed Duration")),
        memorySizeMb: number(found.get("Memory Size")),
        maxMemoryUsedMb: number(found.get("Max Memory Used")),
        initDurationMs: number(found.get("Init Duration")),
        status: found.get("Status"),
        errorType: found.get("Error Type"),
      }),
    };
  }
  if (line.startsWith("INIT_REPORT ")) {
    const found = fields(line);
    return {
      kind: "init",
      ...v.parse(initReportSchema, {
        durationMs: number(found.get("Init Duration")),
        phase: found.get("Phase"),
        status: found.get("Status"),
        errorType: found.get("Error Type"),
      }),
    };
  }
  return undefined;
}
// #endregion text

// #region json
const event = v.object({ type: v.string(), record: v.unknown() });

const reportRecord = v.object({
  requestId: v.string(),
  status: v.optional(status),
  errorType: v.optional(v.string()),
  metrics: v.object({
    durationMs: v.number(),
    billedDurationMs: v.number(),
    memorySizeMB: v.number(),
    maxMemoryUsedMB: v.number(),
    initDurationMs: v.optional(v.number()),
  }),
});

const initReportRecord = v.object({
  initializationType: v.optional(v.string()),
  phase: v.string(),
  status: v.optional(status),
  errorType: v.optional(v.string()),
  metrics: v.object({ durationMs: v.number() }),
});

function fromJson(value: unknown): Line | undefined {
  // The application's own lines are JSON too, and have no `type`.
  const parsed = v.safeParse(event, value);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.output.type === "platform.report") {
    const record = v.parse(reportRecord, parsed.output.record);
    return {
      kind: "report",
      ...v.parse(reportSchema, {
        requestId: record.requestId,
        durationMs: record.metrics.durationMs,
        billedDurationMs: record.metrics.billedDurationMs,
        memorySizeMb: record.metrics.memorySizeMB,
        maxMemoryUsedMb: record.metrics.maxMemoryUsedMB,
        initDurationMs: record.metrics.initDurationMs,
        status: record.status,
        errorType: record.errorType,
      }),
    };
  }
  if (parsed.output.type === "platform.initReport") {
    const record = v.parse(initReportRecord, parsed.output.record);
    return {
      kind: "init",
      ...v.parse(initReportSchema, {
        durationMs: record.metrics.durationMs,
        phase: record.phase,
        initializationType: record.initializationType,
        status: record.status,
        errorType: record.errorType,
      }),
    };
  }
  return undefined;
}
// #endregion json

// #region parse
/**
 * One log message as a report, or `undefined` when it is some other line. A line that
 * claims to be a report and lacks a field throws: the format changed, and silence would
 * turn that into wrong statistics.
 */
export function parseLine(message: string): Line | undefined {
  const line = message.trim();
  if (!line.startsWith("{")) {
    return fromText(line);
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  return fromJson(value);
}

export function parseLines(messages: readonly string[]): Line[] {
  return messages.flatMap((message) => parseLine(message) ?? []);
}
// #endregion parse

// #region summary
export type Spread = { count: number; p50: number; p95: number; max: number };

/** Nearest rank: the smallest value with at least `p` percent of the values at or below it. */
export function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? Number.NaN;
}

function spread(values: readonly number[]): Spread | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = values.toSorted((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1) ?? Number.NaN,
  };
}

export type Summary = {
  invocations: number;
  coldStarts: number;
  /** Handler time of invocations that reused an environment. */
  warmDurationMs: Spread | undefined;
  /** Handler time of the first invocation in an environment, initialization not included. */
  coldDurationMs: Spread | undefined;
  /** Initialization, from cold invocations and from separate init reports. */
  initDurationMs: Spread | undefined;
  billedMs: number;
  billedGbSeconds: number;
  memorySizeMb: number;
  maxMemoryUsedMb: number;
  /** Invocations whose status is present and not `success`. */
  failures: number;
};

export function summarize(lines: readonly Line[]): Summary {
  const reports = lines.filter((line) => line.kind === "report");
  const cold = reports.filter((report) => report.initDurationMs !== undefined);
  const warm = reports.filter((report) => report.initDurationMs === undefined);
  const inits = [
    ...cold.map((report) => report.initDurationMs ?? 0),
    ...lines.filter((line) => line.kind === "init").map((line) => line.durationMs),
  ];
  return {
    invocations: reports.length,
    coldStarts: cold.length,
    warmDurationMs: spread(warm.map((report) => report.durationMs)),
    coldDurationMs: spread(cold.map((report) => report.durationMs)),
    initDurationMs: spread(inits),
    billedMs: reports.reduce((sum, report) => sum + report.billedDurationMs, 0),
    // Each invocation is billed at the memory size it ran with.
    billedGbSeconds: reports.reduce(
      (sum, report) => sum + (report.billedDurationMs / 1000) * (report.memorySizeMb / 1024),
      0,
    ),
    memorySizeMb: Math.max(0, ...reports.map((report) => report.memorySizeMb)),
    maxMemoryUsedMb: Math.max(0, ...reports.map((report) => report.maxMemoryUsedMb)),
    failures: reports.filter((report) => report.status !== undefined && report.status !== "success")
      .length,
  };
}
// #endregion summary
