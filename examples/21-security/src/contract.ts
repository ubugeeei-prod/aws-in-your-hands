import * as v from "valibot";

/** The header a token travels in. Not `Authorization`: CloudFront's origin access control signs with that one. */
export const TOKEN_HEADER = "x-aih-token";

// Unix seconds. v.number() alone would take Infinity, and v.integer() a number too large to be exact.
const unixSeconds = v.pipe(v.number(), v.safeInteger());

export const healthSchema = v.object({ status: v.literal("ok"), stage: v.string() });
export const issuedSchema = v.object({
  token: v.string(),
  keyVersion: v.string(),
  expiresAt: unixSeconds,
});
export const verifiedSchema = v.object({
  subject: v.string(),
  keyVersion: v.string(),
  expiresAt: unixSeconds,
});
export const errorSchema = v.object({
  code: v.picklist(["bad-request", "invalid-token", "expired-token", "signing-key-unavailable"]),
  message: v.string(),
});
export type ApiError = v.InferOutput<typeof errorSchema>;

export const subjectSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_.@-]{1,64}$/));
