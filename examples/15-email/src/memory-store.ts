import type { NotificationState } from "./contract.ts";
import {
  type Advance,
  allowedFrom,
  type Claim,
  type ClaimResult,
  normalizeAddress,
  type NotificationRecord,
  type NotificationStore,
  type Suppression,
} from "./store.ts";

/** For local development and tests. Each method runs without yielding, so it is one step. */
export class MemoryNotificationStore implements NotificationStore {
  readonly #records = new Map<string, NotificationRecord>();
  readonly #suppressions = new Map<string, Suppression>();

  claim(claim: Claim): Promise<ClaimResult> {
    const existing = this.#records.get(claim.notificationId);
    const retryAfterRejection =
      existing?.state === "rejected" && existing.fingerprint === claim.fingerprint;
    if (existing !== undefined && !retryAfterRejection) {
      return Promise.resolve({ claimed: false, existing: { ...existing } });
    }
    this.#records.set(claim.notificationId, {
      notificationId: claim.notificationId,
      to: claim.to,
      fingerprint: claim.fingerprint,
      state: "claimed",
      claimedAt: claim.at,
      updatedAt: claim.at,
      expiresAt: claim.expiresAt,
    });
    return Promise.resolve({ claimed: true });
  }

  advance(
    notificationId: string,
    next: Exclude<NotificationState, "claimed">,
    change: Advance,
  ): Promise<boolean> {
    const record = this.#records.get(notificationId);
    if (record === undefined || !allowedFrom[next].includes(record.state)) {
      return Promise.resolve(false);
    }
    this.#records.set(notificationId, {
      ...record,
      state: next,
      updatedAt: change.at,
      ...(change.messageId === undefined ? {} : { messageId: change.messageId }),
    });
    return Promise.resolve(true);
  }

  get(notificationId: string): Promise<NotificationRecord | undefined> {
    const record = this.#records.get(notificationId);
    return Promise.resolve(record === undefined ? undefined : { ...record });
  }

  findSuppression(address: string): Promise<Suppression | undefined> {
    return Promise.resolve(this.#suppressions.get(normalizeAddress(address)));
  }

  suppress(suppression: Suppression): Promise<void> {
    const address = normalizeAddress(suppression.address);
    this.#suppressions.set(address, { ...suppression, address });
    return Promise.resolve();
  }
}
