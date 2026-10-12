import { describe, expect, it } from "vite-plus/test";

import { MemoryTable } from "@aih/example-30-data-modeling/src/memory-table.ts";

import { digestKey, parseDigest, takeDigest } from "../src/digest.ts";
import { type Entry, seal } from "../src/entry.ts";
import { type Journal, tableJournal } from "../src/journal.ts";
import { MemoryDigests } from "../src/memory-digests.ts";
import { DAY, at, fill, world } from "./support.ts";

const store = () => new MemoryDigests({ mode: "governance", retentionMs: DAY, now: () => at(0) });

describe("takeDigest", () => {
  it("writes nothing for a ledger with no entries", async () => {
    const digests = store();
    const result = await takeDigest(tableJournal(new MemoryTable()), digests, {
      ledger: "notes",
      now: at(1),
    });
    expect(result).toEqual({ kind: "empty" });
    expect(await digests.list("")).toEqual([]);
  });

  it("locks the newest entry's number and hash under a key named after the number", async () => {
    const journal = tableJournal(new MemoryTable());
    const digests = store();
    const entries = await fill(journal, "notes", 1, 3);

    const result = await takeDigest(journal, digests, { ledger: "notes", now: at(9) });

    const digest = { ledger: "notes", seq: 3, hash: entries[2]?.hash, at: at(9).toISOString() };
    expect(result).toEqual({ kind: "written", digest });
    const [version] = await digests.list("digests/notes/");
    expect(version).toMatchObject({ key: "digests/notes/000000000003.json", deleteMarker: false });
    expect(JSON.parse(await digests.get(version?.key ?? "", version?.versionId ?? ""))).toEqual(
      digest,
    );
  });

  it("writes no second digest while nothing was appended", async () => {
    const w = await world();
    const before = await w.digests.list("");
    for (const minute of [10, 11]) {
      await takeDigest(w.journal, w.digests, { ledger: w.ledger, now: at(minute) });
    }
    const second = await takeDigest(w.journal, w.digests, { ledger: w.ledger, now: at(12) });
    expect(second).toEqual({ kind: "unchanged", seq: 6 });
    expect(await w.digests.list("")).toHaveLength(before.length + 1);
  });

  it("reads only from the entry the last digest names", async () => {
    const w = await world();
    const reads: number[] = [];
    const counting: Journal = {
      ...w.journal,
      read(ledger, after, limit) {
        reads.push(after);
        return w.journal.read(ledger, after, limit);
      },
    };
    await takeDigest(counting, w.digests, { ledger: w.ledger, now: at(10) });
    expect(reads).toEqual([3]);
  });

  it("refuses when an entry appended since the last digest was edited", async () => {
    const w = await world();
    await w.overwrite({ ...(w.entries[4] as Entry), event: "forged" });
    const result = await takeDigest(w.journal, w.digests, { ledger: w.ledger, now: at(10) });
    expect(result).toEqual({ kind: "refused", findings: [{ kind: "content_changed", seq: 5 }] });
    expect(await w.digests.list("")).toHaveLength(1);
  });

  it("refuses when the entry the last digest names has another hash now", async () => {
    const w = await world();
    let prev = (w.entries[2] as Entry).hash;
    for (const entry of w.entries.slice(3)) {
      const next = seal({ ...entry, event: "forged", prev });
      await w.overwrite(next);
      prev = next.hash;
    }
    const result = await takeDigest(w.journal, w.digests, { ledger: w.ledger, now: at(10) });
    expect(result).toMatchObject({ kind: "refused", findings: [{ kind: "digest_mismatch" }] });
  });

  it("refuses when the entry the last digest names is gone", async () => {
    const w = await world();
    for (const seq of [4, 5, 6]) {
      await w.erase(seq);
    }
    const result = await takeDigest(w.journal, w.digests, { ledger: w.ledger, now: at(10) });
    expect(result).toMatchObject({ kind: "refused", findings: [{ kind: "truncated" }] });
  });

  it("refuses when the last digest has a delete marker over it", async () => {
    const w = await world();
    w.digests.remove(digestKey(w.ledger, 4));
    const result = await takeDigest(w.journal, w.digests, { ledger: w.ledger, now: at(10) });
    expect(result).toMatchObject({ kind: "refused", findings: [{ kind: "digest_hidden" }] });
  });

  // #region incremental
  it("does not look at entries older than the last digest: that is the full audit's job", async () => {
    const w = await world();
    await w.overwrite({ ...(w.entries[1] as Entry), event: "forged" });
    const result = await takeDigest(w.journal, w.digests, { ledger: w.ledger, now: at(10) });
    expect(result.kind).toBe("written");
  });
  // #endregion incremental
});

describe("parseDigest", () => {
  const body = JSON.stringify({
    ledger: "notes",
    seq: 4,
    hash: "a".repeat(64),
    at: at(1).toISOString(),
  });

  it("reads a digest stored under its own name", () => {
    expect(parseDigest(digestKey("notes", 4), body)).toMatchObject({ seq: 4 });
  });

  it("does not read one stored under another name, or with extra fields", () => {
    expect(parseDigest(digestKey("notes", 5), body)).toBeUndefined();
    expect(parseDigest(digestKey("other", 4), body)).toBeUndefined();
    expect(
      parseDigest(digestKey("notes", 4), JSON.stringify({ ...JSON.parse(body), extra: 1 })),
    ).toBeUndefined();
  });
});
