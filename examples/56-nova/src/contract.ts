import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";
import { failureCodes } from "@aih/example-17-ai/src/contract.ts";

// #region answers
// What the caller sees of a stored description. The upload's key and ETag stay inside.
export const descriptionViewSchema = v.object({
  status: v.literal("ready"),
  outcome: v.picklist(["described", "refused"]),
  /** Absent when the model declined. Plain text: show it as text, never as markup. */
  text: v.optional(v.string()),
  modelId: v.string(),
  createdAt: utcTimestamp,
  /** True when this request did not call the model. */
  reused: v.boolean(),
});
export type DescriptionView = v.InferOutput<typeof descriptionViewSchema>;

export const inProgressSchema = v.object({
  status: v.literal("in_progress"),
  retryAfterSeconds: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
});

export const meSchema = v.object({ owner: v.pipe(v.string(), v.minLength(1)) });
// #endregion answers

// #region error
export const errorCodes = [
  "unauthenticated",
  "not_found",
  // No upload under the caller's own prefix. Another user's attachment looks the same.
  "attachment_missing",
  "not_described",
  "unsupported_image",
  ...failureCodes,
] as const;

export const errorSchema = v.object({
  error: v.object({
    code: v.picklist(errorCodes),
    message: v.string(),
    requestId: v.string(),
    retryable: v.optional(v.boolean()),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorSchema>;
// #endregion error
