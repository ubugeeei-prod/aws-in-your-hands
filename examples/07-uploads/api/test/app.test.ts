import { describe, expect, it } from "vite-plus/test";
import { FINISH_WITHIN_MS, UPLOAD_PERMIT_SECONDS, VIEW_URL_SECONDS } from "../src/attachments.ts";
import { sendUpload } from "../src/client.ts";
import { MAX_ATTACHMENTS_PER_NOTE, MAX_UPLOAD_BYTES, uploadPermitSchema } from "../src/contract.ts";
import { png, rejection, setup } from "./harness.ts";

describe("upload permit", () => {
  it("answers 404 for another user's note, as for a missing one", async () => {
    const { alice, bob } = await setup();
    const note = await alice.notes.create({ title: "trip", body: "" });
    expect(await rejection(bob.attachments.requestUpload(note.id, { contentType: "image/png" }))).toMatchObject({
      status: 404,
      code: "not_found",
    });
    expect(await rejection(bob.attachments.requestUpload("no-such-note", { contentType: "image/png" }))).toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("builds the key from the token and the note, never from the request", async () => {
    const { app, alice, bob } = await setup();
    const aliceNote = await alice.notes.create({ title: "alice's", body: "" });
    const bobNote = await bob.notes.create({ title: "bob's", body: "" });
    // Bob names Alice, and a key under her prefix, everywhere a request can.
    const response = await app.request(`/notes/${bobNote.id}/attachments?owner=alice`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bob.token}`, "x-owner": "alice" },
      body: JSON.stringify({
        contentType: "image/png",
        key: `u/alice/${aliceNote.id}/planted`,
        owner: "alice",
        noteId: aliceNote.id,
        maxBytes: 10 ** 9,
      }),
    });
    expect(response.status).toBe(201);
    const permit = uploadPermitSchema.parse(await response.json());
    expect(permit.upload.fields["key"]).toBe(`u/bob/${bobNote.id}/${permit.attachmentId}`);
    expect(permit.maxBytes).toBe(MAX_UPLOAD_BYTES);
  });

  it("accepts image types from the list only", async () => {
    const { app, alice } = await setup();
    const note = await alice.notes.create({ title: "trip", body: "" });
    for (const contentType of ["image/svg+xml", "text/html", "application/octet-stream"]) {
      const response = await app.request(`/notes/${note.id}/attachments`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ contentType }),
      });
      expect(response.status, contentType).toBe(400);
    }
  });

  it("needs a token, like every other route", async () => {
    const { app } = await setup();
    for (const [method, path] of [
      ["POST", "/notes/x/attachments"],
      ["GET", "/notes/x/attachments"],
      ["PUT", "/notes/x/attachments/y"],
      ["DELETE", "/notes/x/attachments/y"],
    ] as const) {
      expect((await app.request(path, { method })).status, `${method} ${path}`).toBe(401);
    }
  });

  it("leaves no trace when it is never used", async () => {
    const { alice, objects, sweep } = await setup();
    const note = await alice.notes.create({ title: "trip", body: "" });
    const permit = await alice.attachments.requestUpload(note.id, { contentType: "image/png" });
    expect(await alice.attachments.list(note.id)).toEqual([]);
    expect(objects.stateOf(permit.upload.fields["key"] ?? "")).toBeUndefined();
    expect(await sweep({ dryRun: true })).toMatchObject({ kept: 0, tooYoung: 0, removed: [] });
  });
});

// The store here is the in-memory stand-in. These show that the app relies on
// the store to refuse, not that S3 does.
describe("what the upload form allows", () => {
  it("refuses a larger file, another type, another key, and a late upload", async () => {
    const { alice, network, advance } = await setup();
    const note = await alice.notes.create({ title: "trip", body: "" });
    const permit = await alice.attachments.requestUpload(note.id, { contentType: "image/png" });
    const fields = permit.upload.fields;
    const tampered = (change: Record<string, string>) => ({
      ...permit,
      upload: { ...permit.upload, fields: { ...fields, ...change } },
    });

    expect(await rejection(sendUpload(permit, png(MAX_UPLOAD_BYTES + 1), network))).toMatchObject({ status: 400 });
    expect(await rejection(sendUpload(tampered({ "Content-Type": "text/html" }), png(), network))).toMatchObject({
      status: 403,
    });
    expect(
      await rejection(sendUpload(tampered({ key: `u/bob/${note.id}/${permit.attachmentId}` }), png(), network)),
    ).toMatchObject({ status: 403 });

    advance(UPLOAD_PERMIT_SECONDS * 1000 + 1000);
    expect(await rejection(sendUpload(permit, png(), network))).toMatchObject({ status: 403 });
    expect(await rejection(alice.attachments.finish(note.id, permit.attachmentId))).toMatchObject({
      code: "upload_missing",
    });
  });
});

describe("attaching an image", () => {
  it("records it once the upload is finished", async () => {
    const { alice, objects, network } = await setup();
    const note = await alice.notes.create({ title: "trip", body: "" });
    const attachment = await alice.attachments.attach(note.id, png(42), "image/png");

    expect(attachment).toMatchObject({ noteId: note.id, contentType: "image/png", size: 42 });
    expect(objects.stateOf(`u/alice/${note.id}/${attachment.id}`)).toBe("attached");
    const [listed] = await alice.attachments.list(note.id);
    expect(listed).toMatchObject({ id: attachment.id, size: 42 });

    const image = await network(listed?.url ?? "");
    expect(image.headers.get("content-type")).toBe("image/png");
    expect((await image.arrayBuffer()).byteLength).toBe(42);
  });

  it("answers 409 when nothing was uploaded", async () => {
    const { alice } = await setup();
    const note = await alice.notes.create({ title: "trip", body: "" });
    const permit = await alice.attachments.requestUpload(note.id, { contentType: "image/png" });
    expect(await rejection(alice.attachments.finish(note.id, permit.attachmentId))).toMatchObject({
      status: 409,
      code: "upload_missing",
    });
    expect(await alice.attachments.list(note.id)).toEqual([]);
  });

  it("cannot finish, list, or delete under another user's note", async () => {
    const { alice, bob, objects, network } = await setup();
    const note = await alice.notes.create({ title: "trip", body: "" });
    const permit = await alice.attachments.requestUpload(note.id, { contentType: "image/png" });
    await sendUpload(permit, png(), network);

    expect(await rejection(bob.attachments.finish(note.id, permit.attachmentId))).toMatchObject({ status: 404 });
    expect(await rejection(bob.attachments.list(note.id))).toMatchObject({ status: 404 });
    await alice.attachments.finish(note.id, permit.attachmentId);
    expect(await rejection(bob.attachments.remove(note.id, permit.attachmentId))).toMatchObject({ status: 404 });
    expect(objects.stateOf(`u/alice/${note.id}/${permit.attachmentId}`)).toBe("attached");
    expect(await alice.attachments.list(note.id)).toHaveLength(1);
  });

  it("refuses to finish an upload that arrived too long ago", async () => {
    const { alice, objects, network, advance } = await setup();
    const note = await alice.notes.create({ title: "trip", body: "" });
    const permit = await alice.attachments.requestUpload(note.id, { contentType: "image/png" });
    await sendUpload(permit, png(), network);

    advance(FINISH_WITHIN_MS + 1000);
    expect(await rejection(alice.attachments.finish(note.id, permit.attachmentId))).toMatchObject({
      status: 409,
      code: "upload_rejected",
    });
    // Still pending, so the lifecycle rule will expire it.
    expect(objects.stateOf(`u/alice/${note.id}/${permit.attachmentId}`)).toBe("pending");
    expect(await alice.attachments.list(note.id)).toEqual([]);
  });

  it("stops at ten images per note", async () => {
    const { alice } = await setup();
    const note = await alice.notes.create({ title: "album", body: "" });
    for (let count = 0; count < MAX_ATTACHMENTS_PER_NOTE; count++) {
      await alice.attachments.attach(note.id, png(), "image/png");
    }
    expect(await rejection(alice.attachments.requestUpload(note.id, { contentType: "image/png" }))).toMatchObject({
      status: 409,
      code: "attachment_limit",
    });
  });
});

describe("view URL", () => {
  it("works for anyone who holds it, until it expires", async () => {
    const { alice, network, advance } = await setup();
    const note = await alice.notes.create({ title: "trip", body: "" });
    await alice.attachments.attach(note.id, png(), "image/png");
    const [listed] = await alice.attachments.list(note.id);
    const url = listed?.url ?? "";

    // No Authorization header: the URL is the credential.
    expect((await network(url)).status).toBe(200);
    expect((await network(url.replace(/signature=\w{4}/, "signature=0000"))).status).toBe(403);

    advance(VIEW_URL_SECONDS * 1000 + 1000);
    expect((await network(url)).status).toBe(403);
  });
});
