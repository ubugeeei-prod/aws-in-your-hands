import { z } from "zod";

// #region header-safe
/** CR, LF and the other control characters end a mail header and start a new one. */
export function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      return true;
    }
  }
  return false;
}

// Checked before trim(), so a trailing line break is refused rather than quietly dropped.
const headerText = (max: number) =>
  z
    .string()
    .refine(
      (value) => !hasControlCharacter(value),
      "must not contain line breaks or control characters",
    )
    .trim()
    .min(1)
    .max(max);

// One bare address. "Name <a@example.com>", lists and line breaks do not parse as one.
export const emailAddressSchema = z.email().max(254);
// #endregion header-safe

// #region request
// Becomes an SES message tag: letters, digits, _ and - only.
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const shareNotificationSchema = z.object({
  /** The caller's name for this one notification. Sending it twice sends one mail. */
  notificationId: idSchema,
  to: emailAddressSchema,
  sharedBy: headerText(60),
  noteId: idSchema,
  noteTitle: headerText(120),
});
export type ShareNotification = z.infer<typeof shareNotificationSchema>;
// #endregion request

// #region states
export const notificationStates = [
  "claimed",
  "rejected",
  "sent",
  "delivered",
  "bounced",
  "complained",
] as const;
export type NotificationState = (typeof notificationStates)[number];

export const suppressionReasons = ["bounce", "complaint"] as const;
export type SuppressionReason = (typeof suppressionReasons)[number];
// #endregion states

// #region result
export const shareNotificationResultSchema = z.discriminatedUnion("status", [
  // SES took the message. Whether it arrives is reported later, as an event.
  z.object({ status: z.literal("accepted"), notificationId: idSchema, messageId: z.string() }),
  // Already claimed by an earlier request. Nothing was sent this time.
  z.object({
    status: z.literal("duplicate"),
    notificationId: idSchema,
    state: z.enum(notificationStates),
  }),
  z.object({
    status: z.literal("suppressed"),
    notificationId: idSchema,
    reason: z.enum(suppressionReasons),
  }),
]);
export type ShareNotificationResult = z.infer<typeof shareNotificationResultSchema>;
// #endregion result

export const notificationStatusSchema = z.object({
  notificationId: idSchema,
  state: z.enum(notificationStates),
  to: emailAddressSchema,
  claimedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  messageId: z.string().optional(),
});

export const healthSchema = z.object({
  status: z.literal("ok"),
  stage: z.string(),
  mode: z.enum(["local", "aws"]),
});

// #region error
export const errorCodes = [
  "invalid_request",
  "not_found",
  "payload_too_large",
  // The same notificationId arrived with different content.
  "idempotency_conflict",
  // SES refused the message. Asking again with the same notificationId tries again.
  "send_rejected",
  // No answer from SES. Asking again will not send: the claim stays.
  "send_unknown",
  "internal",
] as const;

export const errorSchema = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string(),
    requestId: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorSchema>;
// #endregion error
