import type { NotificationState, ShareNotification, SuppressionReason } from "./contract.ts";
import type { Logger } from "./log.ts";
import type { Mailer, SendResult } from "./mailer.ts";
import { buildShareEmail, fingerprint, type MailSettings } from "./message.ts";
import type { NotificationStore } from "./store.ts";

export type NotifyDeps = {
  store: NotificationStore;
  mailer: Mailer;
  log: Logger;
  now: () => Date;
  settings: MailSettings & { retentionDays: number };
};

export type NotifyOutcome =
  | { outcome: "sent"; messageId: string }
  | { outcome: "duplicate"; state: NotificationState }
  | { outcome: "suppressed"; reason: SuppressionReason }
  | { outcome: "conflict" }
  | { outcome: "rejected"; reason: string }
  | { outcome: "unknown" };

// #region notify
export async function sendShareNotification(
  deps: NotifyDeps,
  input: ShareNotification,
): Promise<NotifyOutcome> {
  const email = buildShareEmail(input, deps.settings);
  const id = input.notificationId;

  const suppression = await deps.store.findSuppression(email.to);
  if (suppression !== undefined) {
    return { outcome: "suppressed", reason: suppression.reason };
  }

  // 1. Record first. Whoever gets the claim is the only one allowed to send.
  const now = deps.now();
  const print = fingerprint(email);
  const claim = await deps.store.claim({
    notificationId: id,
    to: email.to,
    fingerprint: print,
    at: now.toISOString(),
    expiresAt: Math.floor(now.getTime() / 1000) + deps.settings.retentionDays * 86_400,
  });
  if (!claim.claimed) {
    return claim.existing.fingerprint === print
      ? { outcome: "duplicate", state: claim.existing.state }
      : { outcome: "conflict" };
  }

  // 2. Send. From here on a crash leaves the claim behind, and the claim blocks a second send.
  let result: SendResult;
  try {
    result = await deps.mailer.send(email);
  } catch (error) {
    // Sent or not? Nobody knows. The claim stays, so no retry can send a second copy.
    deps.log({
      level: "error",
      message: "send outcome unknown",
      notificationId: id,
      error: String(error),
    });
    return { outcome: "unknown" };
  }

  if (result.kind === "rejected") {
    // A definite "no": give the claim back so that the caller's retry may send.
    await deps.store.advance(id, "rejected", { at: deps.now().toISOString() });
    return { outcome: "rejected", reason: result.reason };
  }

  // 3. Note the message ID. The mail is already out; failing here must not look like a failed send.
  try {
    await deps.store.advance(id, "sent", {
      at: deps.now().toISOString(),
      messageId: result.messageId,
    });
  } catch (error) {
    deps.log({
      level: "warn",
      message: "sent, but the record was not updated",
      notificationId: id,
      error: String(error),
    });
  }
  return { outcome: "sent", messageId: result.messageId };
}
// #endregion notify
