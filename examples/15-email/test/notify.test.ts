import { describe, expect, it } from "vite-plus/test";
import type { Mailer } from "../src/mailer.ts";
import { buildShareEmail } from "../src/message.ts";
import { type NotifyDeps, sendShareNotification } from "../src/notify.ts";
import { type Fault, input, settings, setup, withFault } from "./setup.ts";

// The invariant: one notificationId never puts more than one mail in the outbox.

describe("one notification, one mail", () => {
  it("sends once and records the message ID", async () => {
    const { deps, store, outbox } = setup();
    expect(await sendShareNotification(deps, input)).toEqual({ outcome: "sent", messageId: "local-1" });
    expect(outbox.sent).toHaveLength(1);
    expect(await store.get("share-1")).toMatchObject({ state: "sent", messageId: "local-1" });
  });

  it("answers a repeated request without sending again", async () => {
    const { deps, outbox } = setup();
    await sendShareNotification(deps, input);
    expect(await sendShareNotification(deps, input)).toEqual({ outcome: "duplicate", state: "sent" });
    expect(outbox.sent).toHaveLength(1);
  });

  it("lets one of several simultaneous requests send", async () => {
    const { deps, outbox } = setup();
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => sendShareNotification(deps, input)));
    expect(outcomes.filter((result) => result.outcome === "sent")).toHaveLength(1);
    expect(outcomes.filter((result) => result.outcome === "duplicate")).toHaveLength(4);
    expect(outbox.sent).toHaveLength(1);
  });

  it("refuses the same ID for a different mail", async () => {
    const { deps, outbox } = setup();
    await sendShareNotification(deps, input);
    expect(await sendShareNotification(deps, { ...input, noteTitle: "Another note" })).toEqual({ outcome: "conflict" });
    expect(await sendShareNotification(deps, { ...input, to: "someone-else@example.com" })).toEqual({
      outcome: "conflict",
    });
    expect(outbox.sent).toHaveLength(1);
  });

  it("keeps the record for the configured number of days", async () => {
    const { deps, store } = setup();
    await sendShareNotification(deps, input);
    const record = await store.get("share-1");
    expect(record?.expiresAt).toBe(Date.parse(record?.claimedAt ?? "") / 1000 + 30 * 86_400);
  });
});

// #region fault-table
// Every place the flow can break, and how many mails exist after the caller
// has retried twice. 0 is the price of recording first: the mail is lost, not doubled.
const faults: (Fault & { mails: 0 | 1 })[] = [
  { step: "findSuppression", when: "before", mails: 1 },
  { step: "findSuppression", when: "after", mails: 1 },
  { step: "claim", when: "before", mails: 1 },
  { step: "claim", when: "after", mails: 0 },
  { step: "send", when: "before", mails: 0 },
  { step: "send", when: "after", mails: 1 },
  { step: "advance", when: "before", mails: 1 },
  { step: "advance", when: "after", mails: 1 },
];
// #endregion fault-table

describe("a failure at any step", () => {
  for (const fault of faults) {
    it(`${fault.step} failing ${fault.when} it takes effect leaves ${fault.mails} mail after retries`, async () => {
      const { deps, store, outbox } = setup();
      const broken: NotifyDeps = { ...deps, ...withFault(store, outbox, fault) };

      await sendShareNotification(broken, input).catch(() => "the request failed");
      await sendShareNotification(deps, input);
      await sendShareNotification(deps, input);

      expect(outbox.sent).toHaveLength(fault.mails);
    });
  }

  it("reports an unanswered send as unknown and leaves the claim in place", async () => {
    const { deps, store, outbox, logs } = setup();
    const broken: NotifyDeps = { ...deps, ...withFault(store, outbox, { step: "send", when: "after" }) };

    expect(await sendShareNotification(broken, input)).toEqual({ outcome: "unknown" });
    expect(await store.get("share-1")).toMatchObject({ state: "claimed" });
    expect(await sendShareNotification(deps, input)).toEqual({ outcome: "duplicate", state: "claimed" });
    expect(logs).toContainEqual(expect.objectContaining({ level: "error", notificationId: "share-1" }));
  });

  it("still reports sent when only the record update fails", async () => {
    const { deps, store, outbox } = setup();
    const broken: NotifyDeps = { ...deps, ...withFault(store, outbox, { step: "advance", when: "before" }) };
    expect(await sendShareNotification(broken, input)).toMatchObject({ outcome: "sent" });
  });
});

describe("a send that the provider refuses", () => {
  const refuseOnce = (next: Mailer): Mailer => {
    let refused = false;
    return {
      send: (email) => {
        if (refused) {
          return next.send(email);
        }
        refused = true;
        return Promise.resolve({ kind: "rejected", reason: "TooManyRequestsException" });
      },
    };
  };

  it("gives the claim back, so the retry sends exactly once", async () => {
    const { deps, outbox, store } = setup();
    const throttled: NotifyDeps = { ...deps, mailer: refuseOnce(outbox) };

    expect(await sendShareNotification(throttled, input)).toEqual({
      outcome: "rejected",
      reason: "TooManyRequestsException",
    });
    expect(await store.get("share-1")).toMatchObject({ state: "rejected" });
    expect(await sendShareNotification(throttled, input)).toMatchObject({ outcome: "sent" });
    expect(await sendShareNotification(throttled, input)).toEqual({ outcome: "duplicate", state: "sent" });
    expect(outbox.sent).toHaveLength(1);
  });

  it("does not retry once a delivery event shows the mail went out after all", async () => {
    // SES documents this: rarely, a request that returned an error was accepted anyway.
    const { deps, outbox, store } = setup();
    const throttled: NotifyDeps = { ...deps, mailer: refuseOnce(outbox) };
    await sendShareNotification(throttled, input);
    await store.advance("share-1", "delivered", { at: "2026-10-11T00:01:00.000Z" });

    expect(await sendShareNotification(throttled, input)).toEqual({ outcome: "duplicate", state: "delivered" });
    expect(outbox.sent).toHaveLength(0);
  });
});

describe("a suppressed address", () => {
  it("is not mailed, and the notification is not claimed", async () => {
    const { deps, store, outbox } = setup();
    await store.suppress({
      address: "Recipient@Example.com",
      reason: "bounce",
      suppressedAt: "2026-10-10T00:00:00.000Z",
      feedbackId: "f-1",
    });
    expect(await sendShareNotification(deps, input)).toEqual({ outcome: "suppressed", reason: "bounce" });
    expect(outbox.sent).toHaveLength(0);
    expect(await store.get("share-1")).toBeUndefined();
  });
});

// #region send-first
describe("the other order, for comparison", () => {
  it("send first, record after: a lost response becomes a second mail", async () => {
    const { store, outbox } = setup();
    const sendFirst = async (mailer: Mailer) => {
      if ((await store.get(input.notificationId)) !== undefined) {
        return "duplicate";
      }
      const email = buildShareEmail(input, settings);
      await mailer.send(email);
      await store.claim({
        notificationId: input.notificationId,
        to: email.to,
        fingerprint: "x",
        at: "t",
        expiresAt: 0,
      });
      return "sent";
    };
    const lostResponse = withFault(store, outbox, { step: "send", when: "after" }).mailer;

    await sendFirst(lostResponse).catch(() => "the request failed");
    await sendFirst(outbox);

    expect(outbox.sent).toHaveLength(2);
  });
});
// #endregion send-first
