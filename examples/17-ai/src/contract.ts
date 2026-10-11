import { z } from "zod";

// #region request
// The same limits as a note in chapter 04. They bound what one request can cost.
export const MAX_TITLE_CHARS = 120;
export const MAX_BODY_CHARS = 10_000;

export const summarizeRequestSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  body: z.string().trim().min(1).max(MAX_BODY_CHARS),
});
export type SummarizeRequest = z.infer<typeof summarizeRequestSchema>;
// #endregion request

// #region events
export const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof usageSchema>;

export const failureCodes = [
  "throttled",
  "unavailable",
  "timeout",
  "cancelled",
  "interrupted",
  "bad_output",
  "rejected",
  "misconfigured",
  "internal",
] as const;

export const failureSchema = z.object({
  code: z.enum(failureCodes),
  // True when sending the same request again may succeed.
  retryable: z.boolean(),
});
export type Failure = z.infer<typeof failureSchema>;

export const summaryEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  // Exactly one of the next two ends every stream that was not cut.
  z.object({
    type: z.literal("done"),
    stopReason: z.string(),
    // False when the model stopped for any reason other than finishing.
    complete: z.boolean(),
    usage: usageSchema.nullable(),
  }),
  failureSchema.extend({ type: z.literal("error") }),
]);
export type SummaryEvent = z.infer<typeof summaryEventSchema>;
// #endregion events

export const healthSchema = z.object({
  status: z.literal("ok"),
  stage: z.string(),
  backend: z.enum(["fixture", "bedrock"]),
  modelId: z.string(),
});

// #region error
export const errorSchema = z.object({
  error: z.object({
    code: z.enum(["invalid_request", "not_found", "payload_too_large", ...failureCodes]),
    message: z.string(),
    requestId: z.string(),
    retryable: z.boolean().optional(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorSchema>;
// #endregion error
