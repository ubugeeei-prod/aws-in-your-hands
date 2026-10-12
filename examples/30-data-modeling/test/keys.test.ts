import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  attachmentSk,
  isNoteSk,
  legacyAttachmentSk,
  noteCollection,
  noteSk,
  parseLegacyAttachmentSk,
  parseTagSk,
  recentSk,
  tagSk,
} from "../src/keys.ts";
import { idSchema, slugSchema, taggedNoteSchema, tagSchema } from "../src/model.ts";
import { note } from "./support.ts";

describe("keys", () => {
  it("put a note's attachments inside its range and every other note outside", () => {
    const [from, to] = noteCollection("n1");
    const inside = (sk: string) => sk >= from && sk <= to;
    expect(inside(noteSk("n1"))).toBe(true);
    expect(inside(attachmentSk("n1", "zzzz"))).toBe(true);
    // IDs that sort just before and just after, and one that only extends it.
    for (const other of ["n0", "n10", "n1a", "n2", "n"]) {
      expect(inside(noteSk(other))).toBe(false);
      expect(inside(attachmentSk(other, "a1"))).toBe(false);
    }
  });

  it("sort the recent list by time whatever precision the timestamp was written with", () => {
    const keys = [
      recentSk("2026-10-13T00:00:00Z", "a"),
      recentSk("2026-10-13T00:00:00.5Z", "b"),
      recentSk("2026-10-13T00:00:00.050Z", "c"),
      recentSk("2026-10-13T00:00:01.000Z", "d"),
    ];
    expect(keys.toSorted().map((key) => key.at(-1))).toEqual(["a", "c", "b", "d"]);
    expect(new Set(keys.map((key) => key.length)).size).toBe(1);
  });

  it("refuse a separator inside anything that becomes part of a key", () => {
    for (const bad of ["a#b", "", "A", "trip notes", "x".repeat(65)]) {
      expect(v.is(idSchema, bad)).toBe(false);
      expect(v.is(tagSchema, bad)).toBe(false);
      expect(v.is(slugSchema, bad)).toBe(false);
    }
    expect(v.is(taggedNoteSchema, note("n1", { tags: ["trip", "trip"] }))).toBe(false);
    expect(
      v.is(taggedNoteSchema, note("n1", { tags: Array.from({ length: 9 }, (_, i) => `t${i}`) })),
    ).toBe(false);
  });

  it("read a tag key back into its parts, and nothing else as a tag key", () => {
    expect(parseTagSk(tagSk("trip-2026", "n1"))).toEqual({ tag: "trip-2026", noteId: "n1" });
    for (const other of ["TAGCOUNT#trip", "APPLIED#event-1", noteSk("n1"), "TAG#trip#NOTE#n1#x"]) {
      expect(parseTagSk(other)).toBeUndefined();
    }
    expect(parseLegacyAttachmentSk(legacyAttachmentSk("n1", "a1"))).toEqual({
      noteId: "n1",
      id: "a1",
    });
    expect(parseLegacyAttachmentSk(attachmentSk("n1", "a1"))).toBeUndefined();
  });

  // Why the old list query has to be retired before the first attachment is written under the new key.
  it("the new attachment key falls inside chapter 05's list query", () => {
    const moved = attachmentSk("n1", "a1");
    expect(moved.startsWith("NOTE#")).toBe(true);
    expect(isNoteSk(moved)).toBe(false);
    expect(isNoteSk(noteSk("n1"))).toBe(true);
    expect(legacyAttachmentSk("n1", "a1").startsWith("NOTE#")).toBe(false);
  });
});
