import { describe, expect, it } from "vite-plus/test";

import { SOURCE } from "../src/contract.ts";
import { compile, matches, UnsupportedPatternError } from "../src/pattern.ts";
import { ARCHIVE_PATTERN, PIPE_FILTER, RULES } from "../src/routes.ts";
import { enrich } from "../src/shape.ts";
import {
  inspectionWritten,
  noteInserted,
  noteModified,
  noteRemoved,
  streamRecord,
} from "./fixtures.ts";

/** What the bus would hand to the rules for one stream record. */
const published = (record: unknown) =>
  enrich([record]).map((detail) => ({ source: SOURCE, "detail-type": detail.type, detail }));

describe("the rules on the bus", () => {
  const created = published(noteInserted("n1"))[0];
  const updated = published(noteModified("n1", 1, 2))[0];
  const deleted = published(noteRemoved("n1"))[0];
  const passed = published(inspectionWritten("ok"))[0];
  const rejected = published(inspectionWritten("rejected"))[0];

  it("timeline: every change to a note, and no inspection", () => {
    const rule = compile(RULES.timeline);
    expect([created, updated, deleted].map(rule)).toEqual([true, true, true]);
    expect([passed, rejected].map(rule)).toEqual([false, false]);
  });

  it("counter: creations and deletions, not updates", () => {
    const rule = compile(RULES.counter);
    expect([created, deleted].map(rule)).toEqual([true, true]);
    expect([updated, passed, rejected].map(rule)).toEqual([false, false, false]);
  });

  it("rejections: an inspection that failed, and not one that passed", () => {
    const rule = compile(RULES.rejections);
    expect(rule(rejected)).toBe(true);
    expect([passed, created].map(rule)).toEqual([false, false]);
  });

  it("rejections: not a replayed one, which the other two rules still take", () => {
    const again = { ...rejected, "replay-name": "fix-1" };
    expect(matches(RULES.rejections, again)).toBe(false);
    expect(matches(RULES.timeline, { ...created, "replay-name": "fix-1" })).toBe(true);
    expect(matches(RULES.counter, { ...created, "replay-name": "fix-1" })).toBe(true);
  });

  it("no rule matches an event from another source, or of a later schema version", () => {
    for (const pattern of Object.values(RULES)) {
      expect(matches(pattern, { ...rejected, source: "someone.else" })).toBe(false);
      expect(matches(pattern, { ...created, source: "someone.else" })).toBe(false);
      expect(matches(pattern, { ...created, detail: { ...created?.detail, version: 2 } })).toBe(
        false,
      );
    }
  });

  it("the archive keeps all of them", () => {
    const archive = compile(ARCHIVE_PATTERN);
    expect([created, updated, deleted, passed, rejected].map(archive)).toEqual(
      Array.from({ length: 5 }, () => true),
    );
  });
});

describe("the pipe's filter", () => {
  const filter = compile(PIPE_FILTER);

  it("lets notes and inspection records through", () => {
    expect(filter(noteInserted("n1"))).toBe(true);
    expect(filter(noteRemoved("n1"))).toBe(true);
    expect(filter(inspectionWritten("ok"))).toBe(true);
  });

  it("keeps out every other item in the table", () => {
    expect(filter(streamRecord("MODIFY", "QUOTA", { new: { noteCount: 3 } }))).toBe(false);
    expect(filter(streamRecord("INSERT", "ATTACHMENT#n1#a1", { new: { noteId: "n1" } }))).toBe(
      false,
    );
  });
});

describe("the matcher itself", () => {
  const event = { detail: { state: "running", count: 3, flag: false, none: null, tags: ["a"] } };

  it("needs every named field to match, and any one of a field's values", () => {
    expect(matches({ detail: { state: ["stopped", "running"], count: [3] } }, event)).toBe(true);
    expect(matches({ detail: { state: ["running"], count: [4] } }, event)).toBe(false);
  });

  it("does not match a field that is missing or nested differently", () => {
    expect(matches({ detail: { missing: ["x"] } }, event)).toBe(false);
    expect(matches({ state: ["running"] }, event)).toBe(false);
    expect(matches({ detail: { state: { inner: ["running"] } } }, event)).toBe(false);
  });

  it("compares strings exactly, and tells a number from its spelling", () => {
    expect(matches({ detail: { state: ["Running"] } }, event)).toBe(false);
    expect(matches({ detail: { count: ["3"] } }, event)).toBe(false);
    expect(matches({ detail: { flag: [false], none: [null] } }, event)).toBe(true);
  });

  it("prefix and suffix", () => {
    expect(matches({ detail: { state: [{ prefix: "run" }] } }, event)).toBe(true);
    expect(matches({ detail: { state: [{ suffix: "ning" }] } }, event)).toBe(true);
    expect(matches({ detail: { state: [{ prefix: "stop" }] } }, event)).toBe(false);
    expect(matches({ detail: { count: [{ prefix: "3" }] } }, event)).toBe(false);
  });

  it("exists, for a leaf that is there and one that is not", () => {
    expect(matches({ detail: { state: [{ exists: true }] } }, event)).toBe(true);
    expect(matches({ detail: { missing: [{ exists: true }] } }, event)).toBe(false);
    expect(matches({ detail: { missing: [{ exists: false }] } }, event)).toBe(true);
    expect(matches({ "replay-name": [{ exists: false }] }, event)).toBe(true);
  });

  it("numeric, with one bound or two", () => {
    expect(matches({ detail: { count: [{ numeric: [">", 0, "<=", 3] }] } }, event)).toBe(true);
    expect(matches({ detail: { count: [{ numeric: ["<", 3] }] } }, event)).toBe(false);
    expect(matches({ detail: { state: [{ numeric: [">", 0] }] } }, event)).toBe(false);
  });

  it("refuses what it does not implement instead of guessing", () => {
    for (const pattern of [
      { $or: [{ a: ["x"] }, { b: ["y"] }] },
      { detail: { state: [{ "anything-but": "stopped" }] } },
      { detail: { state: [{ "equals-ignore-case": "RUNNING" }] } },
      { detail: { state: [{ wildcard: "run*" }] } },
      { detail: { ip: [{ cidr: "10.0.0.0/24" }] } },
      { detail: { state: [{ prefix: { "equals-ignore-case": "run" } }] } },
      { detail: { state: [] } },
      { detail: { state: "running" } },
    ]) {
      expect(() => compile(pattern), JSON.stringify(pattern)).toThrow(UnsupportedPatternError);
    }
    // An array in the event is found only when an event arrives.
    expect(() => matches({ detail: { tags: ["a"] } }, event)).toThrow(UnsupportedPatternError);
  });
});
