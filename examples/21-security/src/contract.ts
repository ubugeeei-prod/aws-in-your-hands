import { z } from "zod";

/** The header a token travels in. Not `Authorization`: CloudFront's origin access control signs with that one. */
export const TOKEN_HEADER = "x-aih-token";

export const healthSchema = z.object({ status: z.literal("ok"), stage: z.string() });
export const issuedSchema = z.object({ token: z.string(), keyVersion: z.string(), expiresAt: z.number().int() });
export const verifiedSchema = z.object({ subject: z.string(), keyVersion: z.string(), expiresAt: z.number().int() });
export const errorSchema = z.object({
  code: z.enum(["bad-request", "invalid-token", "expired-token", "signing-key-unavailable"]),
  message: z.string(),
});
export type ApiError = z.infer<typeof errorSchema>;

export const subjectSchema = z.string().regex(/^[A-Za-z0-9_.@-]{1,64}$/);
