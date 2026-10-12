import * as v from "valibot";

import { DEFAULT_VOICE, VOICE_IDS } from "./voices.ts";

// #region request
// The same bounds as a note in chapter 04: nothing longer can be asked for.
export const speechRequestSchema = v.object({
  title: v.pipe(v.string(), v.maxLength(120)),
  body: v.pipe(v.string(), v.maxLength(10_000)),
  voice: v.optional(v.picklist(VOICE_IDS), DEFAULT_VOICE),
});
export type SpeechRequest = v.InferOutput<typeof speechRequestSchema>;
// #endregion request

// #region response
export const speechResponseSchema = v.object({
  voice: v.picklist(VOICE_IDS),
  engine: v.picklist(["neural", "standard"]),
  /** Play them in this order. */
  parts: v.array(
    v.object({
      url: v.pipe(v.string(), v.url()),
      source: v.picklist(["cache", "synthesized", "waited"]),
    }),
  ),
  /** Characters Polly billed for this request. 0 when every part was already there. */
  billedCharacters: v.pipe(v.number(), v.integer(), v.minValue(0)),
  expiresInSeconds: v.number(),
});
export type SpeechResponse = v.InferOutput<typeof speechResponseSchema>;
// #endregion response

export const errorBodySchema = v.object({
  error: v.object({
    code: v.picklist([
      "invalid_request",
      "payload_too_large",
      "nothing_to_read",
      "busy",
      "throttled",
      "not_found",
      "internal",
    ]),
    message: v.string(),
    requestId: v.string(),
    retryable: v.optional(v.boolean()),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorBodySchema>;
