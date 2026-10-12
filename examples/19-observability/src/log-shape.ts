import * as v from "valibot";

// #region shape
const common = {
  level: v.picklist(["debug", "info", "warn", "error"]),
  requestId: v.pipe(v.string(), v.minLength(1)),
  // Absent when no tracer is running.
  traceId: v.optional(v.pipe(v.string(), v.regex(/^[0-9a-f]{32}$/))),
  spanId: v.optional(v.pipe(v.string(), v.regex(/^[0-9a-f]{16}$/))),
  sampled: v.optional(v.boolean()),
};

// Strict on purpose: a field nobody listed here (a header, a body, a token)
// fails the test instead of reaching CloudWatch Logs.
export const requestLineSchema = v.strictObject({
  ...common,
  message: v.literal("request"),
  method: v.string(),
  path: v.pipe(v.string(), v.startsWith("/")),
  status: v.pipe(v.number(), v.integer()),
  durationMs: v.pipe(v.number(), v.minValue(0)),
});

export const errorLineSchema = v.strictObject({
  ...common,
  message: v.literal("unhandled error"),
  error: v.string(),
});

export const logLineSchema = v.variant("message", [requestLineSchema, errorLineSchema]);
export type LogLine = v.InferOutput<typeof logLineSchema>;
// #endregion shape

export function parseLogLines(lines: readonly string[]): LogLine[] {
  return lines.map((line) => v.parse(logLineSchema, JSON.parse(line)));
}
