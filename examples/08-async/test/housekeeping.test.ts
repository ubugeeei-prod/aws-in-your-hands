import { SWEEP_GRACE_MS } from "@aih/example-07-uploads/api/src/sweep.ts";
import { describe, expect, it } from "vite-plus/test";
import { UNTAG_WINDOW_MS } from "../src/housekeeping.ts";
import { HTML, PNG_3X2 } from "./fixtures.ts";
import { type Context, setup } from "./harness.ts";

// What the schedule starts. It reads the bucket and the table and never
// depends on an event having arrived.

async function attached(context: Context, bytes: Uint8Array = PNG_3X2) {
  const upload = await context.upload(bytes);
  await context.attachments.finish(upload.note.id, upload.attachmentId);
  return upload;
}

describe("an attached image that failed the inspection", () => {
  it("is removed, record first, once it is old enough", async () => {
    const context = await setup();
    const upload = await attached(context, HTML);
    await context.deliver();

    // Inside chapter 07's grace period nothing is touched.
    expect(await context.housekeep({ dryRun: false })).toMatchObject({ rejected: [] });
    expect(await context.attachments.list(upload.note.id)).toHaveLength(1);

    context.advance(SWEEP_GRACE_MS);
    expect(await context.housekeep({ dryRun: false })).toMatchObject({
      rejected: [{ key: upload.key, reason: "not_an_image" }],
    });
    expect(await context.attachments.list(upload.note.id)).toEqual([]);
    expect(context.bucket.stateOf(upload.key)).toBeUndefined();

    // The delete is an event too, and the worker drops its record of the object.
    await context.deliver();
    expect(context.inspections.all()).toEqual([]);
  });

  it("is kept when the verdict is about bytes that have since been replaced", async () => {
    const context = await setup();
    const upload = await attached(context, HTML);
    await context.deliver();
    // A good image replaces the bad one, and its event is still in the queue.
    context.advance(1000);
    await upload.send(PNG_3X2);

    context.advance(SWEEP_GRACE_MS);
    expect(await context.housekeep({ dryRun: false })).toMatchObject({ rejected: [] });
    expect(await context.attachments.list(upload.note.id)).toHaveLength(1);
  });

  it("is only listed in a dry run", async () => {
    const context = await setup();
    const upload = await attached(context, HTML);
    await context.deliver();
    context.advance(SWEEP_GRACE_MS);

    expect(await context.housekeep({ dryRun: true })).toMatchObject({ rejected: [{ key: upload.key }] });
    expect(await context.attachments.list(upload.note.id)).toHaveLength(1);
  });
});

describe("the pending tag on an attached image", () => {
  it("is taken off again even if the event that would have done it never arrives", async () => {
    const context = await setup();
    const upload = await attached(context);
    await upload.send(PNG_3X2);
    // Both events are lost to the worker: received, never handled, never seen again here.
    context.queue.receive(10);
    expect(context.bucket.stateOf(upload.key)).toBe("pending");

    context.advance(SWEEP_GRACE_MS);
    expect(await context.housekeep({ dryRun: false })).toMatchObject({ untagged: 1 });
    expect(context.bucket.stateOf(upload.key)).toBe("attached");
  });

  it("is left alone on images too old for the lifecycle rule to matter", async () => {
    const context = await setup();
    await attached(context);
    context.advance(UNTAG_WINDOW_MS);
    expect(await context.housekeep({ dryRun: false })).toMatchObject({ untagged: 0, orphans: { kept: 1 } });
  });
});

describe("housekeeping that runs twice, or stops halfway", () => {
  it("still removes chapter 07's orphans", async () => {
    const context = await setup();
    const upload = await context.upload();
    context.advance(SWEEP_GRACE_MS);
    expect(await context.housekeep({ dryRun: false })).toMatchObject({
      orphans: { removed: [{ key: upload.key, reason: "no_record" }] },
    });
  });

  it("two runs at once end where one run ends", async () => {
    const context = await setup();
    const bad = await attached(context, HTML);
    const orphan = await context.upload();
    const good = await attached(context);
    await context.deliver();
    context.advance(SWEEP_GRACE_MS);

    await Promise.all([context.housekeep({ dryRun: false }), context.housekeep({ dryRun: false })]);

    expect(context.bucket.stateOf(bad.key)).toBeUndefined();
    expect(context.bucket.stateOf(orphan.key)).toBeUndefined();
    expect(context.bucket.stateOf(good.key)).toBe("attached");
    expect(await context.attachments.list(good.note.id)).toHaveLength(1);
    expect(await context.housekeep({ dryRun: false })).toMatchObject({ rejected: [], orphans: { removed: [] } });
  });

  it("stopped between the record and the object: the next run finishes the job", async () => {
    const context = await setup();
    const upload = await attached(context, HTML);
    await context.deliver();
    context.advance(SWEEP_GRACE_MS);

    context.failNext("bucket", "delete");
    await expect(context.housekeep({ dryRun: false })).rejects.toThrow("injected failure");
    // The record is gone and the object is not: an orphan, which is the allowed half.
    expect(await context.attachments.list(upload.note.id)).toEqual([]);
    expect(context.bucket.stateOf(upload.key)).toBe("attached");

    expect(await context.housekeep({ dryRun: false })).toMatchObject({
      orphans: { removed: [{ key: upload.key, reason: "no_record" }] },
    });
    expect(context.bucket.stateOf(upload.key)).toBeUndefined();
  });
});
