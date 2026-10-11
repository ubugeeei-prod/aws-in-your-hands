import { z } from "zod";
import { type NotificationState, notificationStates, suppressionReasons } from "./contract.ts";

// #region records
export const notificationRecordSchema = z.object({
  notificationId: z.string(),
  to: z.string(),
  fingerprint: z.string(),
  state: z.enum(notificationStates),
  claimedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  messageId: z.string().optional(),
  /** Unix seconds. DynamoDB deletes the record some time after this. */
  expiresAt: z.number().int(),
});
export type NotificationRecord = z.infer<typeof notificationRecordSchema>;

export const suppressionSchema = z.object({
  address: z.string(),
  reason: z.enum(suppressionReasons),
  suppressedAt: z.iso.datetime(),
  feedbackId: z.string(),
});
export type Suppression = z.infer<typeof suppressionSchema>;
// #endregion records

/** Addresses compare without case here. Suppressing one address too many beats mailing one that bounced. */
export const normalizeAddress = (address: string): string => address.trim().toLowerCase();

// #region transitions
/**
 * The states a record may be in for a move to the key to apply.
 * Signals arrive late, twice and out of order; anything not listed is ignored.
 */
export const allowedFrom: Record<Exclude<NotificationState, "claimed">, readonly NotificationState[]> = {
  rejected: ["claimed"],
  sent: ["claimed"],
  // A delivery event can overtake the "sent" write, and can prove a "rejected" wrong.
  delivered: ["claimed", "rejected", "sent"],
  bounced: ["claimed", "rejected", "sent", "delivered"],
  complained: ["claimed", "rejected", "sent", "delivered"],
};
// #endregion transitions

// #region store
export type Claim = { notificationId: string; to: string; fingerprint: string; at: string; expiresAt: number };
export type ClaimResult = { claimed: true } | { claimed: false; existing: NotificationRecord };
export type Advance = { at: string; messageId?: string };

export interface NotificationStore {
  /**
   * Takes the notification for this caller, as one step. Succeeds when nobody
   * holds it, or when the last attempt at the same mail was rejected.
   */
  claim(claim: Claim): Promise<ClaimResult>;
  /** Moves a record forward if `allowedFrom` permits. False means nothing changed. */
  advance(notificationId: string, next: Exclude<NotificationState, "claimed">, change: Advance): Promise<boolean>;
  get(notificationId: string): Promise<NotificationRecord | undefined>;
  findSuppression(address: string): Promise<Suppression | undefined>;
  /** Safe to repeat: the same event delivered twice leaves one entry. */
  suppress(suppression: Suppression): Promise<void>;
}
// #endregion store
