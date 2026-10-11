import type { ShareNotification } from "../src/contract.ts";
import type { LogEntry } from "../src/log.ts";
import { type Mailer, OutboxMailer } from "../src/mailer.ts";
import { MemoryNotificationStore } from "../src/memory-store.ts";
import type { NotifyDeps } from "../src/notify.ts";
import type { NotificationStore } from "../src/store.ts";

export const input: ShareNotification = {
  notificationId: "share-1",
  to: "recipient@example.com",
  sharedBy: "Aiko",
  noteId: "note-1",
  noteTitle: "Trip plan",
};

export const settings = { fromAddress: "notes@example.com", appOrigin: "https://notes.example.com", retentionDays: 30 };

/** A store, an outbox and a clock that tests own. Nothing here reaches AWS. */
export function setup(overrides: { store?: NotificationStore; mailer?: Mailer } = {}) {
  const store = new MemoryNotificationStore();
  const outbox = new OutboxMailer();
  const logs: LogEntry[] = [];
  let clock = Date.UTC(2026, 9, 11);
  const deps: NotifyDeps = {
    store: overrides.store ?? store,
    mailer: overrides.mailer ?? outbox,
    log: (entry) => logs.push(entry),
    now: () => new Date((clock += 1000)),
    settings,
  };
  return { store, outbox, logs, deps };
}

// #region faults
export type Step = "findSuppression" | "claim" | "send" | "advance";
export type Fault = { step: Step; when: "before" | "after" };

/**
 * Fails once at `fault.step`. "before": the call never happened.
 * "after": it happened, and only the answer was lost.
 */
export function withFault(
  store: NotificationStore,
  mailer: Mailer,
  fault: Fault,
): { store: NotificationStore; mailer: Mailer } {
  let armed = true;
  const wrap = <Args extends unknown[], Result>(step: Step, call: (...args: Args) => Promise<Result>) => {
    return async (...args: Args): Promise<Result> => {
      if (!armed || fault.step !== step) {
        return call(...args);
      }
      armed = false;
      if (fault.when === "after") {
        await call(...args);
      }
      throw new Error(`injected: ${step} failed ${fault.when} taking effect`);
    };
  };
  return {
    store: {
      findSuppression: wrap("findSuppression", (address) => store.findSuppression(address)),
      claim: wrap("claim", (claim) => store.claim(claim)),
      advance: wrap("advance", (id, next, change) => store.advance(id, next, change)),
      get: (id) => store.get(id),
      suppress: (suppression) => store.suppress(suppression),
    },
    mailer: { send: wrap("send", (email) => mailer.send(email)) },
  };
}
// #endregion faults
