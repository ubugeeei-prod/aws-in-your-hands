import { describe, expect, it } from "vite-plus/test";

import { GENESIS, entryKey, hashOf, seal, toEntry, toRow } from "../src/entry.ts";

const first = {
  ledger: "notes",
  seq: 1,
  at: "2026-10-13T00:00:00.000Z",
  event: "{}",
  prev: GENESIS,
};

describe("entry", () => {
  it("hashes the same entry to the same value, pinned here", () => {
    // A change to the encoding would orphan every ledger already written.
    expect(hashOf(first)).toBe("4cbe508e62f9d421c4167cd4eba1357e568fa67a829c8fe7c4b12bca9d49a858");
  });

  it("changes the hash when any field changes", () => {
    const hashes = new Set([
      hashOf(first),
      hashOf({ ...first, ledger: "other" }),
      hashOf({ ...first, seq: 2 }),
      hashOf({ ...first, at: "2026-10-13T00:00:00.001Z" }),
      hashOf({ ...first, event: "{ }" }),
      hashOf({ ...first, prev: "1".repeat(64) }),
    ]);
    expect(hashes.size).toBe(6);
  });

  it("keeps fields apart: text cannot move from one field into the next", () => {
    expect(hashOf({ ...first, at: "a", event: 'b","c' })).not.toBe(
      hashOf({ ...first, at: 'a","b', event: "c" }),
    );
  });

  it("orders keys as numbers", () => {
    expect(entryKey(9) < entryKey(10)).toBe(true);
  });

  it("reads back what it wrote", () => {
    const entry = seal(first);
    expect(toEntry("notes", toRow(entry))).toEqual(entry);
  });

  it("does not read a row whose number disagrees with its key", () => {
    const row = toRow(seal(first));
    expect(toEntry("notes", { ...row, seq: 2 })).toBeUndefined();
    expect(toEntry("notes", { ...row, sk: entryKey(2) })).toBeUndefined();
  });

  it("does not read a row with a missing or misshapen field", () => {
    const row = toRow(seal(first));
    expect(toEntry("notes", { ...row, hash: "abc" })).toBeUndefined();
    expect(toEntry("notes", { ...row, seq: 1.5 })).toBeUndefined();
    expect(toEntry("notes", { ...row, event: undefined })).toBeUndefined();
    expect(toEntry("notes", undefined)).toBeUndefined();
  });
});
