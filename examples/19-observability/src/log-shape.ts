import { z } from "zod";

// #region shape
const common = {
  level: z.enum(["debug", "info", "warn", "error"]),
  requestId: z.string().min(1),
  // Absent when no tracer is running.
  traceId: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  spanId: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional(),
  sampled: z.boolean().optional(),
};

// Strict on purpose: a field nobody listed here (a header, a body, a token)
// fails the test instead of reaching CloudWatch Logs.
export const requestLineSchema = z.strictObject({
  ...common,
  message: z.literal("request"),
  method: z.string(),
  path: z.string().startsWith("/"),
  status: z.number().int(),
  durationMs: z.number().nonnegative(),
});

export const errorLineSchema = z.strictObject({
  ...common,
  message: z.literal("unhandled error"),
  error: z.string(),
});

export const logLineSchema = z.discriminatedUnion("message", [requestLineSchema, errorLineSchema]);
export type LogLine = z.infer<typeof logLineSchema>;
// #endregion shape

export function parseLogLines(lines: readonly string[]): LogLine[] {
  return lines.map((line) => logLineSchema.parse(JSON.parse(line)));
}
