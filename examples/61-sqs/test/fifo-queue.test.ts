import { describe, expect, it } from "vite-plus/test";

import { FifoQueue, MAX_VISIBILITY_MS } from "../src/fifo-queue.ts";
import { nextExtension } from "../src/lease.ts";
import { MAX_RECEIVES, setup, VISIBILITY_MS } from "./harness.ts";

// The rules of the model in src/fifo-queue.ts, one at a time. They are the
// documented rules as this chapter read them; none was observed on SQS.

const message = (body: string, groupId: string, deduplicationId = body) => ({
  body,
  groupId,
  deduplicationId,
});

describe("sending", () => {
  it("refuses a message without a group or without a deduplication ID", () => {
    const { queue } = setup();
    expect(() => queue.send(message("a", ""))).toThrow("message group ID");
    expect(() => queue.send(message("a", "g", ""))).toThrow("deduplication ID");
  });

  it("queues nothing for a deduplication ID accepted in the last five minutes", () => {
    const context = setup();
    expect(context.queue.send(message("a", "g", "id-1"))).toBe("queued");
    context.advanceMinutes(4);
    // Another body and another group, and still the same ID.
    expect(context.queue.send(message("b", "h", "id-1"))).toBe("deduplicated");
    expect(context.queue.stats()).toEqual({ visible: 1, inFlight: 0, deduplicated: 1 });
  });

  it("keeps remembering the ID after the message was received and deleted", () => {
    const context = setup();
    context.queue.send(message("a", "g", "id-1"));
    const [received] = context.queue.receive(1);
    expect(context.queue.delete(received?.receiptHandle ?? "")).toBe(true);

    expect(context.queue.send(message("a", "g", "id-1"))).toBe("deduplicated");
    expect(context.queue.receive(1)).toEqual([]);
  });

  it("queues the same ID again once five minutes have passed", () => {
    const context = setup();
    context.queue.send(message("a", "g", "id-1"));
    context.advanceMinutes(5);
    expect(context.queue.send(message("a", "g", "id-1"))).toBe("queued");
    expect(context.queue.bodies()).toEqual(["a", "a"]);
  });
});

describe("receiving", () => {
  it("returns a group's messages in the order they were accepted, and several groups at once", () => {
    const { queue } = setup();
    for (const [body, group] of [
      ["a1", "a"],
      ["b1", "b"],
      ["a2", "a"],
      ["b2", "b"],
    ] as const) {
      queue.send(message(body, group));
    }
    const batch = queue.receive(10);
    expect(batch.map((received) => received.body)).toEqual(["a1", "b1", "a2", "b2"]);
    const sequence = (body: string) =>
      Number(batch.find((received) => received.body === body)?.sequenceNumber);
    expect(sequence("a1")).toBeLessThan(sequence("a2"));
  });

  it("gives nothing more from a group while one of its messages is out", () => {
    const { queue } = setup();
    queue.send(message("a1", "a"));
    queue.send(message("a2", "a"));
    queue.send(message("b1", "b"));

    expect(queue.receive(1).map((received) => received.body)).toEqual(["a1"]);
    // a2 is visible and first in line, and is passed over.
    expect(queue.receive(10).map((received) => received.body)).toEqual(["b1"]);
    expect(queue.receive(10)).toEqual([]);
  });

  it("puts a message that was not deleted back in its place, ahead of the rest of its group", () => {
    const context = setup();
    context.queue.send(message("a1", "a"));
    context.queue.send(message("a2", "a"));
    context.queue.receive(1);

    context.advance(VISIBILITY_MS);
    const again = context.queue.receive(10);
    expect(again.map((received) => [received.body, received.receiveCount])).toEqual([
      ["a1", 2],
      ["a2", 1],
    ]);
  });

  it("deletes nothing for a receipt handle from an earlier receive", () => {
    const context = setup();
    context.queue.send(message("a1", "a"));
    const [first] = context.queue.receive(1);
    context.advance(VISIBILITY_MS);
    const [second] = context.queue.receive(1);

    expect(second?.receiptHandle).not.toBe(first?.receiptHandle);
    expect(context.queue.delete(first?.receiptHandle ?? "")).toBe(false);
    expect(context.queue.delete(second?.receiptHandle ?? "")).toBe(true);
  });
});

describe("the visibility timeout as a lease", () => {
  it("is extended from the moment of the call, and the group stays closed meanwhile", () => {
    const context = setup();
    context.queue.send(message("a1", "a"));
    context.queue.send(message("a2", "a"));
    const [held] = context.queue.receive(1);
    const handle = held?.receiptHandle ?? "";

    context.advance(VISIBILITY_MS - 1000);
    context.queue.changeVisibility(handle, 120);
    context.advance(119_000);
    expect(context.queue.receive(10)).toEqual([]);
    context.advance(1000);
    expect(context.queue.receive(10).map((received) => received.body)).toEqual(["a1", "a2"]);
  });

  it("is ended with zero, for a consumer that will not handle the message", () => {
    const { queue } = setup();
    queue.send(message("a1", "a"));
    const [held] = queue.receive(1);
    queue.changeVisibility(held?.receiptHandle ?? "", 0);
    expect(queue.receive(1).map((received) => received.receiveCount)).toEqual([2]);
  });

  it("cannot be extended past twelve hours after the receive", () => {
    const context = setup();
    context.queue.send(message("a1", "a"));
    const receivedAtMs = Date.parse("2026-10-13T00:00:00.000Z");
    const handle = context.queue.receive(1)[0]?.receiptHandle ?? "";

    // A heartbeat every hour that asks for two more.
    context.queue.changeVisibility(handle, 7200);
    for (let hour = 1; hour <= 11; hour++) {
      context.advance(60 * 60 * 1000);
      const plan = nextExtension({
        receivedAtMs,
        nowMs: receivedAtMs + hour * 3_600_000,
        extendBySeconds: 7200,
      });
      expect(plan).not.toBe("give_up");
      context.queue.changeVisibility(handle, plan === "give_up" ? 0 : plan.seconds);
    }
    // At eleven hours, one hour was left, and that is what was asked for.
    expect(() => context.queue.changeVisibility(handle, 3601)).toThrow("twelve hours");
    context.advance(60 * 60 * 1000);
    expect(
      nextExtension({
        receivedAtMs,
        nowMs: receivedAtMs + MAX_VISIBILITY_MS,
        extendBySeconds: 7200,
      }),
    ).toBe("give_up");
    expect(context.queue.receive(1).map((received) => received.receiveCount)).toEqual([2]);
  });
});

describe("the dead-letter queue", () => {
  const alwaysFail = async (batch: { Records: { messageId: string }[] }) => ({
    batchItemFailures: batch.Records.map((record) => ({ itemIdentifier: record.messageId })),
  });

  it("takes a message at the receive after its last allowed one, and frees the group", async () => {
    const context = setup();
    context.queue.send(message("a1", "a"));
    for (let attempt = 0; attempt < MAX_RECEIVES; attempt++) {
      expect((await context.deliver(alwaysFail)).received).toBe(1);
      context.advance(VISIBILITY_MS);
    }
    context.queue.send(message("a2", "a"));

    expect(context.queue.receive(10).map((received) => received.body)).toEqual(["a2"]);
    expect(context.deadLetters.bodies()).toEqual(["a1"]);
  });

  it("takes along whatever was delivered in the same batches as the message that kept failing", async () => {
    const context = setup();
    context.queue.send(message("poison", "a"));
    context.queue.send(message("a2", "a"));
    context.queue.send(message("b1", "b"));

    // The first message fails every time. The documented answer for a FIFO
    // queue is that message and everything after it: here, the whole batch.
    for (let attempt = 0; attempt < MAX_RECEIVES; attempt++) {
      await context.deliver(alwaysFail);
      context.advance(VISIBILITY_MS);
    }
    expect(context.queue.receive(10)).toEqual([]);
    // Two messages nothing was wrong with, set aside with the one that could never succeed.
    expect(context.deadLetters.bodies()).toEqual(["poison", "a2", "b1"]);
  });

  it("gives its messages back as new messages, oldest first", () => {
    const now = () => new Date("2026-10-13T00:00:00.000Z");
    let ids = 0;
    const newId = () => `m${(ids += 1)}`;
    const deadLetters = new FifoQueue({ now, newId, visibilityTimeoutMs: VISIBILITY_MS });
    const queue = new FifoQueue({ now, newId, visibilityTimeoutMs: VISIBILITY_MS });
    deadLetters.send(message("a1", "a"));
    deadLetters.send(message("a2", "a"));
    queue.send(message("a3", "a"));

    expect(deadLetters.redriveTo(queue)).toBe(2);
    const batch = queue.receive(10);
    // Behind what the queue already held: a redrive does not restore the old order.
    expect(batch.map((received) => received.body)).toEqual(["a3", "a1", "a2"]);
    expect(batch.map((received) => received.messageId)).toEqual(["m3", "m4", "m5"]);
    expect(deadLetters.bodies()).toEqual([]);
  });
});
