import * as v from "valibot";

import { failureCodes, failureSchema, usageSchema } from "@aih/example-17-ai/src/contract.ts";

// #region request
// A query is embedded on every search, so its length is what one search can cost.
export const MAX_QUERY_CHARS = 200;
export const MAX_RESULTS = 10;

const query = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_QUERY_CHARS));

export const searchRequestSchema = v.object({
  query,
  limit: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MAX_RESULTS)), 5),
});
export type SearchRequest = v.InferOutput<typeof searchRequestSchema>;

export const answerRequestSchema = v.object({ question: query });
export type AnswerRequest = v.InferOutput<typeof answerRequestSchema>;
// #endregion request

// #region response
const way = v.picklist(["words", "meaning"]);

export const hitSchema = v.strictObject({
  noteId: v.pipe(v.string(), v.minLength(1)),
  title: v.string(),
  /** The start of the passage that matched best. */
  snippet: v.string(),
  score: v.pipe(v.number(), v.finite()),
  matched: v.array(way),
});
export type Hit = v.InferOutput<typeof hitSchema>;

export const searchResponseSchema = v.strictObject({
  hits: v.pipe(v.array(hitSchema), v.maxLength(MAX_RESULTS)),
  // "unavailable": only the word search answered. The hits are still the caller's own.
  meaning: v.picklist(["used", "unavailable"]),
});
export type SearchResponse = v.InferOutput<typeof searchResponseSchema>;
// #endregion response

// #region events
export const sourceSchema = v.strictObject({
  /** The number the answer cites it by: [1], [2], ... */
  n: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  noteId: v.pipe(v.string(), v.minLength(1)),
  title: v.string(),
});
export type Source = v.InferOutput<typeof sourceSchema>;

export const answerEventSchema = v.variant("type", [
  // First, before any text: the passages the model is about to be shown.
  v.object({ type: v.literal("sources"), sources: v.array(sourceSchema) }),
  v.object({ type: v.literal("delta"), text: v.string() }),
  // Exactly one of the next two ends every stream that was not cut.
  v.object({
    type: v.literal("done"),
    // "no_sources": nothing was found, and no model was called.
    stopReason: v.string(),
    complete: v.boolean(),
    usage: v.nullable(usageSchema),
    /** Numbers in the answer that name a source it was given. */
    citations: v.array(v.number()),
    /** Numbers in the answer that name nothing. A sign the model made a source up. */
    unknownCitations: v.array(v.number()),
  }),
  v.object({ type: v.literal("error"), ...failureSchema.entries }),
]);
export type AnswerEvent = v.InferOutput<typeof answerEventSchema>;
// #endregion events

export const healthSchema = v.object({
  status: v.literal("ok"),
  stage: v.string(),
  backend: v.picklist(["local", "aws"]),
});

export const errorSchema = v.object({
  error: v.object({
    code: v.picklist([
      "invalid_request",
      "unauthenticated",
      "not_found",
      "payload_too_large",
      ...failureCodes,
    ]),
    message: v.string(),
    requestId: v.string(),
    retryable: v.optional(v.boolean()),
    issues: v.optional(v.array(v.object({ path: v.string(), message: v.string() }))),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorSchema>;
