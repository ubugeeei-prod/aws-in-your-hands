import { describe, expect, it } from "vite-plus/test";

import { deliverOnce } from "../src/local-queue.ts";
import { MAX_RECEIVES, setup, VISIBILITY_MS } from "./harness.ts";

// What happens around the worker: batches, failures inside a batch, the
// dead-letter queue, and moving messages back. The queue here is the
// stand-in in src/local-queue.ts, not SQS.

const testEvent = JSON.stringify({ Service: "Amazon S3", Event: "s3:TestEvent", Bucket: "bucket" });

describe("a batch with one bad message", () => {
  it("reports only the bad one, so the good ones are not retried", async () => {
    const context = await setup();
    const first = await context.upload();
    const poison = context.queue.send("this is not JSON");
    const second = await context.upload();

    const batch = context.queue.receive(10);
    const response = await context.worker({ Records: batch });

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: poison }] });
    expect(await context.inspections.get("alice", first.note.id, first.attachmentId)).toBeDefined();
    expect(
      await context.inspections.get("alice", second.note.id, second.attachmentId),
    ).toBeDefined();
  });

  it("a message that never succeeds ends in the dead-letter queue, not in a loop", async () => {
    const context = await setup();
    await context.upload();
    context.queue.send("this is not JSON");

    for (let attempt = 0; attempt < MAX_RECEIVES; attempt++) {
      await context.deliver();
      context.advance(VISIBILITY_MS);
    }
    // One more receive finds it over the limit and sets it aside.
    expect(await context.deliver()).toBe(0);

    expect(context.queue.stats()).toEqual({ visible: 0, inFlight: 0, dead: 1 });
    expect(context.queue.dead()).toEqual([
      expect.objectContaining({ body: "this is not JSON", receiveCount: MAX_RECEIVES }),
    ]);
    // The upload in the same batches was handled once, on the first try.
    expect(context.outcomes()).toEqual(["recorded"]);
  });

  it("if the handler throws, the whole batch comes back", async () => {
    const context = await setup();
    await context.upload();
    await context.upload();
    const crash = async () => {
      throw new Error("out of memory");
    };

    await expect(deliverOnce(context.queue, crash, 10)).rejects.toThrow("out of memory");
    expect(context.queue.stats()).toEqual({ visible: 0, inFlight: 2, dead: 0 });

    context.advance(VISIBILITY_MS);
    await context.deliver();
    expect(context.inspections.all()).toHaveLength(2);
  });
});

describe("messages the worker has no work for", () => {
  it("acknowledges the test event S3 sends when the notification is set up", async () => {
    const context = await setup();
    context.queue.send(testEvent);
    await context.deliver();
    expect(context.queue.stats()).toEqual({ visible: 0, inFlight: 0, dead: 0 });
  });

  it("acknowledges events for keys this app did not write", async () => {
    const context = await setup();
    context.queue.send(
      JSON.stringify({
        Records: [
          {
            eventName: "ObjectCreated:Put",
            s3: { object: { key: "logs/2026.txt", eTag: "abc", sequencer: "0A" } },
          },
        ],
      }),
    );
    await context.deliver();
    expect(context.outcomes()).toEqual(["ignored"]);
    expect(context.queue.stats()).toEqual({ visible: 0, inFlight: 0, dead: 0 });
  });
});

describe("the dead-letter queue", () => {
  it("a message parked by a passing fault is handled after it is moved back", async () => {
    const context = await setup();
    const upload = await context.upload();

    // The table is unavailable for longer than the queue is willing to retry.
    context.failNext("inspections", "putIfNewer", MAX_RECEIVES);
    for (let attempt = 0; attempt <= MAX_RECEIVES; attempt++) {
      await context.deliver();
      context.advance(VISIBILITY_MS);
    }
    expect(context.queue.stats()).toEqual({ visible: 0, inFlight: 0, dead: 1 });
    expect(
      await context.inspections.get("alice", upload.note.id, upload.attachmentId),
    ).toBeUndefined();
    const parked = context.queue.dead()[0]?.messageId;

    expect(context.queue.redrive()).toBe(1);
    const [moved] = context.queue.receive(1);
    // A new message with a new ID. Anything keyed on the old ID would not recognize it.
    expect(moved?.messageId).not.toBe(parked);
    expect(moved?.receiveCount).toBe(1);

    context.advance(VISIBILITY_MS);
    await context.deliver();
    expect(
      await context.inspections.get("alice", upload.note.id, upload.attachmentId),
    ).toMatchObject({
      verdict: "ok",
    });
    expect(context.queue.stats()).toEqual({ visible: 0, inFlight: 0, dead: 0 });
  });
});
