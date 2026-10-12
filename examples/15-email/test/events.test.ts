import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import {
  createEventsHandler,
  handleSesMessage,
  parseSesMessage,
  planEventActions,
} from "../src/events.ts";
import type { LogEntry } from "../src/log.ts";
import { sendShareNotification } from "../src/notify.ts";
import type { NotificationStore } from "../src/store.ts";
import { input, setup } from "./setup.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");
// The parts of a fixture that tests change. A test edits a copy, never the file.
type Editable = {
  mail: { tags: Record<string, string[]> };
  bounce: {
    bounceType: string;
    bounceSubType: string;
    bouncedRecipients?: { emailAddress: string }[];
  };
  complaint: { timestamp: string };
};
const edited = (name: string, edit: (event: Editable) => void): string => {
  const event = JSON.parse(fixture(name)) as Editable;
  edit(event);
  return JSON.stringify(event);
};
const sns = (...messages: string[]) => ({
  Records: messages.map((Message, index) => ({
    EventSource: "aws:sns",
    Sns: { MessageId: `m-${index}`, Message },
  })),
});

/** A notification that was sent, and the event dependencies sharing its store. */
async function sent() {
  const context = setup();
  await sendShareNotification(context.deps, input);
  const logs: LogEntry[] = [];
  return {
    ...context,
    logs,
    events: { store: context.store, log: (entry: LogEntry) => logs.push(entry) },
  };
}

describe("bounces and complaints", () => {
  it("suppresses the address after a permanent bounce, and the next notification is not sent", async () => {
    const { events, store, deps, outbox } = await sent();
    await handleSesMessage(events, fixture("bounce"));

    expect(await store.findSuppression("recipient@example.com")).toMatchObject({
      reason: "bounce",
    });
    expect(await store.get("share-1")).toMatchObject({ state: "bounced" });
    expect(await sendShareNotification(deps, { ...input, notificationId: "share-2" })).toEqual({
      outcome: "suppressed",
      reason: "bounce",
    });
    expect(outbox.sent).toHaveLength(1);
  });

  it("does not suppress after a transient bounce", async () => {
    const { events, store } = await sent();
    await handleSesMessage(
      events,
      edited("bounce", (event) => {
        event.bounce.bounceType = "Transient";
        event.bounce.bounceSubType = "MailboxFull";
      }),
    );
    expect(await store.findSuppression("recipient@example.com")).toBeUndefined();
    expect(await store.get("share-1")).toMatchObject({ state: "bounced" });
  });

  it("suppresses the address after a complaint", async () => {
    const { events, store } = await sent();
    await handleSesMessage(events, fixture("complaint"));
    expect(await store.findSuppression("recipient@example.com")).toMatchObject({
      reason: "complaint",
    });
    expect(await store.get("share-1")).toMatchObject({ state: "complained" });
  });

  it("finds the same mailbox whatever the case or display name", async () => {
    const { events, store } = await sent();
    await handleSesMessage(
      events,
      edited("bounce", (event) => {
        event.bounce.bouncedRecipients = [
          { emailAddress: "Recipient Name <Recipient@Example.COM>" },
        ];
      }),
    );
    expect(await store.findSuppression("recipient@example.com")).toBeDefined();
  });

  it("suppresses even when the event names no notification this table knows", async () => {
    const { events, store } = await sent();
    await handleSesMessage(
      events,
      edited("bounce", (event) => {
        event.mail.tags = {};
        event.bounce.bouncedRecipients = [{ emailAddress: "nobody@example.com" }];
      }),
    );
    expect(await store.findSuppression("nobody@example.com")).toBeDefined();
    expect(await store.get("share-1")).toMatchObject({ state: "sent" });
  });
});

describe("events arrive late, twice, and out of order", () => {
  it("gives the same result when an event is delivered twice", async () => {
    const { events, store } = await sent();
    await handleSesMessage(events, fixture("bounce"));
    const once = [await store.get("share-1"), await store.findSuppression("recipient@example.com")];
    await handleSesMessage(events, fixture("bounce"));
    expect([
      await store.get("share-1"),
      await store.findSuppression("recipient@example.com"),
    ]).toEqual(once);
  });

  it("keeps 'delivered' when the delivery event beats the 'sent' write", async () => {
    const { store, deps } = setup();
    const events = { store, log: () => {} };
    // The claim exists, SES has the mail, and the function has not yet written "sent".
    await store.claim({
      notificationId: "share-1",
      to: input.to,
      fingerprint: "f",
      at: "2026-10-11T00:00:00.000Z",
      expiresAt: 0,
    });
    await handleSesMessage(events, fixture("delivery"));

    expect(
      await store.advance("share-1", "sent", { at: deps.now().toISOString(), messageId: "late" }),
    ).toBe(false);
    expect(await store.get("share-1")).toMatchObject({ state: "delivered" });
  });

  it("does not move a bounced notification back to delivered", async () => {
    const { events, store } = await sent();
    await handleSesMessage(events, fixture("bounce"));
    await handleSesMessage(events, fixture("delivery"));
    expect(await store.get("share-1")).toMatchObject({ state: "bounced" });
  });

  it("records a complaint that follows a delivery", async () => {
    const { events, store } = await sent();
    await handleSesMessage(events, fixture("delivery"));
    await handleSesMessage(events, fixture("complaint"));
    expect(await store.get("share-1")).toMatchObject({ state: "complained" });
  });
});

describe("events are outside data", () => {
  it("plans from the documented example records", () => {
    const bounce = parseSesMessage(fixture("bounce"));
    expect(
      bounce.kind === "event" && planEventActions(bounce.event).map((action) => action.kind),
    ).toEqual(["suppress", "advance"]);
  });

  it("ignores event types it has no use for", async () => {
    const { events, store } = await sent();
    const result = await handleSesMessage(
      events,
      JSON.stringify({ eventType: "Open", mail: {}, open: {} }),
    );
    expect(result).toEqual({ kind: "ignored", eventType: "Open" });
    expect(await store.get("share-1")).toMatchObject({ state: "sent" });
  });

  it("drops what it cannot read, with an error in the log, instead of failing forever", async () => {
    const { events, logs, store } = await sent();
    const unreadable = [
      "not json",
      JSON.stringify({ hello: "world" }),
      edited("bounce", (event) => delete event.bounce.bouncedRecipients),
      edited("bounce", (event) => (event.bounce.bounceType = "Sideways")),
      edited("complaint", (event) => (event.complaint.timestamp = "yesterday")),
    ];
    for (const message of unreadable) {
      expect((await handleSesMessage(events, message)).kind).toBe("invalid");
    }
    expect(logs.filter((entry) => entry.level === "error")).toHaveLength(unreadable.length);
    expect(await store.findSuppression("recipient@example.com")).toBeUndefined();
  });

  it("ignores a tag that is not one of our IDs", () => {
    const parsed = parseSesMessage(
      edited("delivery", (event) => (event.mail.tags["notification_id"] = ["../../x"])),
    );
    expect(parsed.kind === "event" && planEventActions(parsed.event)).toEqual([]);
  });
});

describe("the SNS handler", () => {
  it("handles every record of the notification", async () => {
    const { events, store } = await sent();
    await createEventsHandler(events)(sns(fixture("delivery"), fixture("complaint")));
    expect(await store.get("share-1")).toMatchObject({ state: "complained" });
    expect(await store.findSuppression("recipient@example.com")).toBeDefined();
  });

  it("fails when the store fails, so Lambda runs the event again", async () => {
    const { store, logs } = await sent();
    const failing: NotificationStore = {
      claim: (claim) => store.claim(claim),
      advance: (id, next, change) => store.advance(id, next, change),
      get: (id) => store.get(id),
      findSuppression: (address) => store.findSuppression(address),
      suppress: () => Promise.reject(new Error("table unavailable")),
    };
    const handler = createEventsHandler({ store: failing, log: (entry) => logs.push(entry) });
    await expect(handler(sns(fixture("bounce")))).rejects.toThrow(/table unavailable/);
  });

  it("fails on an invocation that is not an SNS event", async () => {
    const { events } = await sent();
    await expect(
      createEventsHandler(events)({ Records: [{ body: "from a queue" }] }),
    ).rejects.toThrow();
  });
});
