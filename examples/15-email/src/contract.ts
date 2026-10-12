import * as v from "valibot";

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
  v.pipe(
    v.string(),
    v.check(
      (value) => !hasControlCharacter(value),
      "must not contain line breaks or control characters",
    ),
    v.trim(),
    v.minLength(1),
    v.maxLength(max),
  );

// One bare address. "Name <a@example.com>", lists and line breaks do not parse as one.
export const emailAddressSchema = v.pipe(v.string(), v.email(), v.maxLength(254));
// #endregion header-safe

// #region request
// Becomes an SES message tag: letters, digits, _ and - only.
const idSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/));

export const shareNotificationSchema = v.object({
  /** The caller's name for this one notification. Sending it twice sends one mail. */
  notificationId: idSchema,
  to: emailAddressSchema,
  sharedBy: headerText(60),
  noteId: idSchema,
  noteTitle: headerText(120),
});
export type ShareNotification = v.InferOutput<typeof shareNotificationSchema>;
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
export const shareNotificationResultSchema = v.variant("status", [
  // SES took the message. Whether it arrives is reported later, as an event.
  v.object({ status: v.literal("accepted"), notificationId: idSchema, messageId: v.string() }),
  // Already claimed by an earlier request. Nothing was sent this time.
  v.object({
    status: v.literal("duplicate"),
    notificationId: idSchema,
    state: v.picklist(notificationStates),
  }),
  v.object({
    status: v.literal("suppressed"),
    notificationId: idSchema,
    reason: v.picklist(suppressionReasons),
  }),
]);
export type ShareNotificationResult = v.InferOutput<typeof shareNotificationResultSchema>;
// #endregion result

export const notificationStatusSchema = v.object({
  notificationId: idSchema,
  state: v.picklist(notificationStates),
  to: emailAddressSchema,
  claimedAt: v.pipe(v.string(), v.isoTimestamp()),
  updatedAt: v.pipe(v.string(), v.isoTimestamp()),
  messageId: v.optional(v.string()),
});

export const healthSchema = v.object({
  status: v.literal("ok"),
  stage: v.string(),
  mode: v.picklist(["local", "aws"]),
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

export const errorSchema = v.object({
  error: v.object({
    code: v.picklist(errorCodes),
    message: v.string(),
    requestId: v.string(),
    issues: v.optional(v.array(v.object({ path: v.string(), message: v.string() }))),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorSchema>;
// #endregion error
