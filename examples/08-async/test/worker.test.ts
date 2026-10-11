import { describe, expect, it } from "vite-plus/test";
import { HTML, GIF_3X2, PNG_1X1, PNG_3X2, pngDeclaring } from "./fixtures.ts";
import { type Context, setup, VISIBILITY_MS } from "./harness.ts";

// The invariant: for one object key there is at most one inspection record,
// and it describes the newest create event the worker has handled. Delivering
// an event again, late, or to two workers at once does not change that.
//
// Each test fixes one order of events and looks at the record afterwards.

const record = (context: Context, upload: { note: { id: string }; attachmentId: string }) =>
  context.inspections.get("alice", upload.note.id, upload.attachmentId);
/** Lets everything that can run, run: a held call is then the only thing waiting. */
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));
const asBatch = (messages: { messageId: string; body: string }[]) => ({
  Records: messages.map(({ messageId, body }) => ({ messageId, body })),
});

describe("one event, delivered more than once", () => {
  it("records what is in the bytes", async () => {
    const context = await setup();
    const upload = await context.upload(PNG_3X2);
    await context.deliver();
    expect(await record(context, upload)).toMatchObject({ verdict: "ok", width: 3, height: 2, size: 170 });
    expect(context.queue.stats()).toEqual({ visible: 0, inFlight: 0, dead: 0 });
  });

  it("the same message again: nothing changes", async () => {
    const context = await setup();
    const upload = await context.upload();
    const messages = context.queue.receive(10);
    await context.worker(asBatch(messages));
    const first = await record(context, upload);

    // The delete never reached the queue, so the message came back.
    context.advance(VISIBILITY_MS);
    const response = await context.worker(asBatch(messages));

    expect(response.batchItemFailures).toEqual([]);
    expect(context.outcomes()).toEqual(["recorded", "duplicate"]);
    // Not even the timestamp moved: the second run wrote nothing.
    expect(await record(context, upload)).toEqual(first);
  });

  it("the same event as two messages with two IDs: still one record", async () => {
    // The key for "have I seen this?" has to come from the event. A message ID
    // names a delivery, and S3 sending an event twice makes two of them.
    const context = await setup({ duplicate: true });
    const upload = await context.upload();
    const messages = context.queue.receive(10);
    expect(new Set(messages.map((message) => message.messageId)).size).toBe(2);

    await context.worker(asBatch(messages));
    expect(context.outcomes()).toEqual(["recorded", "duplicate"]);
    expect(context.inspections.all()).toHaveLength(1);
    expect(await record(context, upload)).toMatchObject({ verdict: "ok" });
  });

  it("two workers hold the same message at once: one record, and neither fails", async () => {
    const context = await setup();
    const upload = await context.upload();
    const [message] = context.queue.receive(10);
    if (message === undefined) {
      throw new Error("no message");
    }

    // Worker A reads the object, decides, and is about to write...
    const release = context.holdNext("inspections", "putIfNewer");
    const a = context.worker(asBatch([message]));
    await settled();
    // ...when the visibility timeout runs out, and the queue hands the message to worker B.
    context.advance(VISIBILITY_MS);
    const [again] = context.queue.receive(10);
    expect(again).toMatchObject({ messageId: message.messageId, receiveCount: 2 });
    expect(await context.worker(asBatch([message]))).toEqual({ batchItemFailures: [] });
    const afterB = await record(context, upload);

    release();
    expect(await a).toEqual({ batchItemFailures: [] });
    expect(context.outcomes()).toEqual(["recorded", "duplicate"]);
    expect(await record(context, upload)).toEqual(afterB);

    // A's delete uses the handle of a receive that has expired. B's is the one that counts.
    expect(context.queue.delete(message.receiptHandle)).toBe(false);
    expect(context.queue.delete(again?.receiptHandle ?? "")).toBe(true);
    expect(context.queue.stats()).toEqual({ visible: 0, inFlight: 0, dead: 0 });
  });
});

describe("events out of order", () => {
  it("an older create arrives after a newer one: the newer record stays", async () => {
    const context = await setup();
    const upload = await context.upload(PNG_3X2);
    // The same form, sent again with other bytes: a second create for the same key.
    await upload.send(PNG_1X1);
    const [older, newer] = context.queue.receive(10);
    if (older === undefined || newer === undefined) {
      throw new Error("expected two messages");
    }

    await context.worker(asBatch([newer]));
    await context.worker(asBatch([older]));

    // The older event's bytes are no longer there to read, so it has nothing to say.
    expect(context.outcomes()).toEqual(["recorded", "superseded"]);
    expect(await record(context, upload)).toMatchObject({ width: 1, height: 1 });
  });

  it("an older create for identical bytes arrives late: the newer sequencer stays", async () => {
    const context = await setup();
    const upload = await context.upload(PNG_3X2);
    await upload.send(PNG_3X2);
    const [older, newer] = context.queue.receive(10);
    if (older === undefined || newer === undefined) {
      throw new Error("expected two messages");
    }

    await context.worker(asBatch([newer]));
    const afterNewer = await record(context, upload);
    await context.worker(asBatch([older]));

    // Same ETag, so the older event can read the bytes. The condition on the write stops it.
    expect(context.outcomes()).toEqual(["recorded", "duplicate"]);
    expect(await record(context, upload)).toEqual(afterNewer);
  });

  it("a delete arrives before the create it follows: no record is left behind", async () => {
    const context = await setup();
    const upload = await context.upload();
    await context.bucket.delete(upload.key);
    const [created, removed] = context.queue.receive(10);
    if (created === undefined || removed === undefined) {
      throw new Error("expected two messages");
    }

    await context.worker(asBatch([removed]));
    await context.worker(asBatch([created]));

    expect(context.outcomes()).toEqual(["forgotten", "gone"]);
    expect(await record(context, upload)).toBeUndefined();
  });

  it("a late delete does not erase the record of an object created after it", async () => {
    const context = await setup();
    const upload = await context.upload(PNG_3X2);
    await context.bucket.delete(upload.key);
    await upload.send(PNG_1X1);
    const [, removed, recreated] = context.queue.receive(10);
    if (removed === undefined || recreated === undefined) {
      throw new Error("expected three messages");
    }

    await context.worker(asBatch([recreated]));
    await context.worker(asBatch([removed]));

    expect(context.outcomes()).toEqual(["recorded", "kept"]);
    expect(await record(context, upload)).toMatchObject({ width: 1, height: 1 });
  });
});

describe("a worker that stops halfway", () => {
  it("before the record is written: the retry writes it, once", async () => {
    const context = await setup();
    const upload = await context.upload();
    context.failNext("inspections", "putIfNewer");

    await context.deliver();
    expect(await record(context, upload)).toBeUndefined();
    // Reported as failed, so it was not deleted. It is hidden until the timeout.
    expect(context.queue.stats()).toEqual({ visible: 0, inFlight: 1, dead: 0 });

    context.advance(VISIBILITY_MS);
    await context.deliver();
    expect(await record(context, upload)).toMatchObject({ verdict: "ok" });
    expect(context.queue.stats()).toEqual({ visible: 0, inFlight: 0, dead: 0 });
  });

  it("after the record, before the tag is repaired: the retry still repairs the tag", async () => {
    const context = await setup();
    const upload = await context.upload();
    await context.attachments.finish(upload.note.id, upload.attachmentId);
    await context.deliver();
    // Chapter 07's gap: the form is sent again, and the attached image is pending again.
    await upload.send(PNG_3X2);
    expect(context.bucket.stateOf(upload.key)).toBe("pending");

    context.failNext("bucket", "markAttached");
    await context.deliver();
    // The record of the new event is written; the step after it did not run.
    expect(context.bucket.stateOf(upload.key)).toBe("pending");
    expect(context.queue.stats()).toMatchObject({ inFlight: 1 });

    context.advance(VISIBILITY_MS);
    await context.deliver();
    // "Already recorded" was not taken as "already done".
    expect(context.outcomes().at(-1)).toBe("duplicate");
    expect(context.bucket.stateOf(upload.key)).toBe("attached");
    expect(context.queue.stats()).toEqual({ visible: 0, inFlight: 0, dead: 0 });
  });
});

describe("chapter 07's gap", () => {
  it("a form sent again after finishing no longer leaves the image pending", async () => {
    const context = await setup();
    const upload = await context.upload();
    await context.attachments.finish(upload.note.id, upload.attachmentId);
    await upload.send(PNG_3X2);
    expect(context.bucket.stateOf(upload.key)).toBe("pending");

    await context.deliver();
    expect(context.bucket.stateOf(upload.key)).toBe("attached");
  });

  it("an upload that was never finished stays pending, for the lifecycle rule", async () => {
    const context = await setup();
    const upload = await context.upload();
    await context.deliver();
    expect(await record(context, upload)).toMatchObject({ verdict: "ok" });
    expect(context.bucket.stateOf(upload.key)).toBe("pending");
  });
});

describe("what the bytes say", () => {
  it.each([
    ["HTML named image/png", HTML, "not_an_image"],
    ["a GIF named image/png", GIF_3X2, "type_mismatch"],
    ["a PNG that declares 60,000 x 60,000 pixels", pngDeclaring(60_000, 60_000), "too_many_pixels"],
  ])("rejects %s", async (_name, bytes, reason) => {
    const context = await setup();
    const upload = await context.upload(bytes);
    await context.deliver();
    expect(await record(context, upload)).toMatchObject({ verdict: "rejected", reason, declaredType: "image/png" });
  });
});
