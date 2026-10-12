import * as v from "valibot";

// #region request
// The same limits as a note in chapter 04. They bound what one request can cost.
export const MAX_TITLE_CHARS = 120;
export const MAX_BODY_CHARS = 10_000;

export const summarizeRequestSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_TITLE_CHARS)),
  body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_BODY_CHARS)),
});
export type SummarizeRequest = v.InferOutput<typeof summarizeRequestSchema>;
// #endregion request

// #region events
export const usageSchema = v.object({
  inputTokens: v.pipe(v.number(), v.integer(), v.minValue(0)),
  outputTokens: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type Usage = v.InferOutput<typeof usageSchema>;

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

export const failureSchema = v.object({
  code: v.picklist(failureCodes),
  // True when sending the same request again may succeed.
  retryable: v.boolean(),
});
export type Failure = v.InferOutput<typeof failureSchema>;

export const summaryEventSchema = v.variant("type", [
  v.object({ type: v.literal("delta"), text: v.string() }),
  // Exactly one of the next two ends every stream that was not cut.
  v.object({
    type: v.literal("done"),
    stopReason: v.string(),
    // False when the model stopped for any reason other than finishing.
    complete: v.boolean(),
    usage: v.nullable(usageSchema),
  }),
  v.object({ type: v.literal("error"), ...failureSchema.entries }),
]);
export type SummaryEvent = v.InferOutput<typeof summaryEventSchema>;
// #endregion events

export const healthSchema = v.object({
  status: v.literal("ok"),
  stage: v.string(),
  backend: v.picklist(["fixture", "bedrock"]),
  modelId: v.string(),
});

// #region error
export const errorSchema = v.object({
  error: v.object({
    code: v.picklist(["invalid_request", "not_found", "payload_too_large", ...failureCodes]),
    message: v.string(),
    requestId: v.string(),
    retryable: v.optional(v.boolean()),
    issues: v.optional(v.array(v.object({ path: v.string(), message: v.string() }))),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorSchema>;
// #endregion error
