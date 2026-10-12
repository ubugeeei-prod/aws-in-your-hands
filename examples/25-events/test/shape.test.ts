import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { attachmentInspectedSchema, domainEventSchema, noteEventSchema } from "../src/contract.ts";
import { enrich, shape } from "../src/shape.ts";
import {
  inspection,
  inspectionWritten,
  note,
  noteInserted,
  noteModified,
  noteRemoved,
  OWNER,
  streamRecord,
} from "./fixtures.ts";

describe("stream records as events", () => {
  it("a new note, an update, and a deletion", () => {
    expect(shape(noteInserted("n1"))).toEqual({
      type: "NoteCreated",
      id: `note:${OWNER}/n1#1`,
      version: 1,
      occurredAt: "2026-10-12T00:00:00.000Z",
      owner: OWNER,
      noteId: "n1",
      noteVersion: 1,
    });
    expect(shape(noteModified("n1", 1, 2))).toMatchObject({
      type: "NoteUpdated",
      id: `note:${OWNER}/n1#2`,
      occurredAt: "2026-10-12T00:02:00.000Z",
      noteVersion: 2,
    });
    expect(shape(noteRemoved("n1", 2))).toMatchObject({
      type: "NoteDeleted",
      id: `note:${OWNER}/n1#deleted`,
      occurredAt: "2026-10-12T00:00:00.000Z",
      noteVersion: 2,
    });
  });

  it("leaves the title and the body out of the event", () => {
    expect(JSON.stringify(shape(noteInserted("n1")))).not.toMatch(/Shopping|milk/);
  });

  it("an inspection record, with the reason when it failed", () => {
    expect(shape(inspectionWritten("rejected"))).toEqual({
      type: "AttachmentInspected",
      id: `inspection:${OWNER}/n1/a1#000000000000000055AED6DCD90281E5`,
      version: 1,
      occurredAt: "2026-10-12T00:05:00.000Z",
      owner: OWNER,
      noteId: "n1",
      attachmentId: "a1",
      verdict: "rejected",
      reason: "not_an_image",
    });
    expect(shape(inspectionWritten("ok"))).not.toHaveProperty("reason");
  });

  it("gives the same change the same ID, whichever stream record reports it", () => {
    const first = noteModified("n1", 1, 2);
    const again = noteModified("n1", 1, 2);
    expect(first.eventID).not.toBe(again.eventID);
    expect(shape(first)?.id).toBe(shape(again)?.id);
  });

  it("says nothing for a write that changed no version, a removed inspection, or another item", () => {
    expect(shape(noteModified("n1", 2, 2))).toBeUndefined();
    expect(
      shape(streamRecord("REMOVE", "INSPECTION#n1#a1", { old: inspection("ok") })),
    ).toBeUndefined();
    expect(shape(streamRecord("MODIFY", "QUOTA", { new: { noteCount: 3 } }))).toBeUndefined();
  });

  it("every event it makes passes the contract", () => {
    for (const record of [
      noteInserted("n1"),
      noteModified("n1", 1, 2),
      noteRemoved("n1"),
      inspectionWritten("ok"),
      inspectionWritten("rejected"),
    ]) {
      expect(v.is(domainEventSchema, shape(record))).toBe(true);
    }
  });

  it("throws on a note it cannot read, so the pipe retries and then sets the record aside", () => {
    const broken = streamRecord("INSERT", "NOTE#n1", { new: { ...note("n1"), version: 0 } });
    expect(() => shape(broken)).toThrow(v.ValiError);
    expect(() => shape({ eventName: "INSERT" })).toThrow(v.ValiError);
  });
});

describe("the enrichment step", () => {
  it("returns one event per record that reports a fact, in order, and drops the rest", () => {
    const events = enrich([noteInserted("n1"), noteModified("n1", 2, 2), noteRemoved("n1")]);
    expect(events.map((event) => event.type)).toEqual(["NoteCreated", "NoteDeleted"]);
    expect(enrich([])).toEqual([]);
  });

  it("refuses an input that is not a batch", () => {
    expect(() => enrich({ Records: [] })).toThrow(v.ValiError);
  });
});

describe("the contract and its version", () => {
  const created = shape(noteInserted("n1"));

  it("a consumer written for today's event reads one that has gained a field", () => {
    const tomorrow = { ...created, tags: ["home"], title: "Shopping" };
    expect(v.parse(noteEventSchema, tomorrow)).toEqual(created);
  });

  it("an event of the next version is refused, not half understood", () => {
    expect(v.is(noteEventSchema, { ...created, version: 2 })).toBe(false);
  });

  it("an event that lost a field is refused", () => {
    const { noteVersion: _dropped, ...rest } = { noteVersion: 0, ...created };
    expect(v.is(noteEventSchema, rest)).toBe(false);
  });

  it("a rejection without a reason is refused", () => {
    const rejected = shape(inspectionWritten("rejected"));
    expect(v.is(attachmentInspectedSchema, rejected)).toBe(true);
    expect(v.is(attachmentInspectedSchema, { ...rejected, reason: undefined })).toBe(false);
  });

  it("an occurredAt that is not a UTC timestamp is refused", () => {
    expect(v.is(noteEventSchema, { ...created, occurredAt: "2026-10-12 09:00:00+09:00" })).toBe(
      false,
    );
  });
});
