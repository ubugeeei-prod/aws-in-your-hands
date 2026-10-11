import { describe, expect, it } from "vite-plus/test";
import { sendUpload } from "../src/client.ts";
import { SWEEP_GRACE_MS } from "../src/sweep.ts";
import { png, rejection, setup } from "./harness.ts";

// The invariant: every attachment record points at an object that exists and
// is out of the lifecycle rule's reach. The reverse (an object without a
// record) is allowed, and is cleaned up.
//
// Each test stops the sequence at one fixed step and looks at both stores.

async function uploaded() {
  const context = await setup();
  const note = await context.alice.notes.create({ title: "trip", body: "" });
  const permit = await context.alice.attachments.requestUpload(note.id, { contentType: "image/png" });
  await sendUpload(permit, png(), context.network);
  return { ...context, note, permit, key: `u/alice/${note.id}/${permit.attachmentId}` };
}

describe("an upload that stops halfway", () => {
  it("uploaded, never finished: an object the lifecycle rule expires, and no record", async () => {
    const { alice, objects, note, key } = await uploaded();
    expect(objects.stateOf(key)).toBe("pending");
    expect(await alice.attachments.list(note.id)).toEqual([]);
  });

  it("tag removed, record not written: a retry ends with exactly one record", async () => {
    const { alice, objects, failNextRecordCall, note, permit, key } = await uploaded();

    failNextRecordCall("create");
    expect(await rejection(alice.attachments.finish(note.id, permit.attachmentId))).toMatchObject({ status: 500 });
    // The gap: the object is out of the lifecycle rule's reach, and nothing points at it.
    expect(objects.stateOf(key)).toBe("attached");
    expect(await alice.attachments.list(note.id)).toEqual([]);

    await alice.attachments.finish(note.id, permit.attachmentId);
    expect(await alice.attachments.list(note.id)).toHaveLength(1);
  });

  it("tag removed, record not written, no retry: the sweep removes the object", async () => {
    const { alice, objects, failNextRecordCall, advance, sweep, note, permit, key } = await uploaded();
    failNextRecordCall("create");
    await rejection(alice.attachments.finish(note.id, permit.attachmentId));

    // Inside the grace period the sweep must not touch it: a retry may still be on its way.
    expect(await sweep()).toMatchObject({ tooYoung: 1, removed: [] });
    expect(objects.stateOf(key)).toBe("attached");

    advance(SWEEP_GRACE_MS);
    expect(await sweep()).toMatchObject({ removed: [{ key, reason: "no_record" }] });
    expect(objects.stateOf(key)).toBeUndefined();
  });

  it("removing the tag fails: nothing is recorded, and a retry succeeds", async () => {
    const { alice, objects, failNextObjectCall, note, permit, key } = await uploaded();
    failNextObjectCall("markAttached");
    expect(await rejection(alice.attachments.finish(note.id, permit.attachmentId))).toMatchObject({ status: 500 });
    expect(objects.stateOf(key)).toBe("pending");
    expect(await alice.attachments.list(note.id)).toEqual([]);

    await alice.attachments.finish(note.id, permit.attachmentId);
    expect(await alice.attachments.list(note.id)).toHaveLength(1);
  });

  it("finished, response lost: asking again returns the same record", async () => {
    const { alice, note, permit } = await uploaded();
    const first = await alice.attachments.finish(note.id, permit.attachmentId);
    // The browser never saw `first`, so it asks again.
    const second = await alice.attachments.finish(note.id, permit.attachmentId);
    expect(second).toEqual(first);
    expect(await alice.attachments.list(note.id)).toHaveLength(1);
  });
});

describe("a delete that stops halfway", () => {
  it("record deleted, object delete fails: nothing dangles, and the sweep collects the object", async () => {
    const { alice, objects, logs, failNextObjectCall, advance, sweep, note, permit, key } = await uploaded();
    await alice.attachments.finish(note.id, permit.attachmentId);

    failNextObjectCall("delete");
    await alice.attachments.remove(note.id, permit.attachmentId);
    expect(await alice.attachments.list(note.id)).toEqual([]);
    expect(objects.stateOf(key)).toBe("attached");
    expect(logs).toContainEqual(expect.objectContaining({ level: "warn", attachmentId: permit.attachmentId }));

    advance(SWEEP_GRACE_MS);
    expect(await sweep()).toMatchObject({ removed: [{ key, reason: "no_record" }] });
    expect(objects.stateOf(key)).toBeUndefined();
  });

  it("deleting a note deletes its records and objects", async () => {
    const { alice, objects, advance, sweep, note, permit, key } = await uploaded();
    await alice.attachments.finish(note.id, permit.attachmentId);
    await alice.notes.remove(note.id);
    expect(objects.stateOf(key)).toBeUndefined();
    advance(SWEEP_GRACE_MS);
    expect(await sweep()).toMatchObject({ kept: 0, removed: [] });
  });

  it("note deleted, cleanup fails: the leftovers are unreachable, then swept", async () => {
    const { alice, objects, failNextRecordCall, advance, sweep, note, permit, key } = await uploaded();
    await alice.attachments.finish(note.id, permit.attachmentId);

    failNextRecordCall("listByNote");
    await alice.notes.remove(note.id);
    // The user's delete succeeded. Record and object are both still there...
    expect(objects.stateOf(key)).toBe("attached");
    // ...but no request can reach them: the note check comes first.
    expect(await rejection(alice.attachments.list(note.id))).toMatchObject({ status: 404 });
    expect(await rejection(alice.attachments.finish(note.id, permit.attachmentId))).toMatchObject({ status: 404 });

    advance(SWEEP_GRACE_MS);
    expect(await sweep()).toMatchObject({ removed: [{ key, reason: "no_note" }] });
    expect(objects.stateOf(key)).toBeUndefined();
    // Record gone too: a second sweep finds nothing.
    expect(await sweep()).toMatchObject({ kept: 0, removed: [] });
  });
});

describe("the sweep", () => {
  it("keeps attached images, however old", async () => {
    const { alice, objects, advance, sweep, note, permit, key } = await uploaded();
    await alice.attachments.finish(note.id, permit.attachmentId);
    advance(30 * 24 * 60 * 60 * 1000);
    expect(await sweep()).toMatchObject({ kept: 1, removed: [] });
    expect(objects.stateOf(key)).toBe("attached");
  });

  it("deletes nothing in a dry run", async () => {
    const { objects, advance, sweep, key } = await uploaded();
    advance(SWEEP_GRACE_MS);
    expect(await sweep({ dryRun: true })).toMatchObject({ removed: [{ key, reason: "no_record" }] });
    expect(objects.stateOf(key)).toBe("pending");
  });
});

describe("a gap this design leaves open", () => {
  it("a permit can be used again until it expires, which puts the object back to pending", async () => {
    const { alice, objects, network, note, permit, key } = await uploaded();
    await alice.attachments.finish(note.id, permit.attachmentId);
    expect(objects.stateOf(key)).toBe("attached");

    // Same form, sent a second time inside its five minutes. S3 replaces the
    // object and applies the tag in the form again. The record now points at an
    // object the lifecycle rule will delete. The chapter says what closes this.
    await sendUpload(permit, png(9), network);
    expect(objects.stateOf(key)).toBe("pending");
    expect(await alice.attachments.list(note.id)).toHaveLength(1);
  });
});
