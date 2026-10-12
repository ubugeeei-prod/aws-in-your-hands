import { describe, expect, it } from "vite-plus/test";

import { audit } from "../src/audit.ts";
import { digestKey, takeDigest } from "../src/digest.ts";
import { type Entry, seal } from "../src/entry.ts";
import { DAY, at, world } from "./support.ts";

const kinds = (result: { findings: { kind: string }[] }) =>
  result.findings.map((finding) => finding.kind);

/** The chain from `seq` to the end again, as someone who can rewrite the table would write it. */
function rewrittenFrom(entries: Entry[], seq: number, event: string): Entry[] {
  const out: Entry[] = [];
  let prev = (entries[seq - 2] as Entry).hash;
  for (const entry of entries.slice(seq - 1)) {
    const next = seal({ ...entry, event: entry.seq === seq ? event : entry.event, prev });
    out.push(next);
    prev = next.hash;
  }
  return out;
}

describe("audit of an untouched ledger", () => {
  it("finds nothing, and says how many entries no digest covers yet", async () => {
    const w = await world();
    expect(await audit(w.journal, w.digests, w.ledger)).toEqual({
      entries: 6,
      digests: 1,
      uncovered: 2,
      findings: [],
    });
  });
});

describe("changes to past entries", () => {
  it("detects an entry whose content was edited", async () => {
    const w = await world();
    await w.overwrite({ ...(w.entries[1] as Entry), event: "forged" });
    expect((await audit(w.journal, w.digests, w.ledger)).findings).toEqual([
      { kind: "content_changed", seq: 2 },
    ]);
  });

  it("detects an edited entry whose own hash was recomputed", async () => {
    const w = await world();
    await w.overwrite(seal({ ...(w.entries[1] as Entry), event: "forged" }));
    expect((await audit(w.journal, w.digests, w.ledger)).findings).toEqual([
      { kind: "broken_link", seq: 3 },
    ]);
  });

  // #region rewrite
  it("detects a chain rewritten all the way to the end, by the locked digest alone", async () => {
    const w = await world();
    for (const entry of rewrittenFrom(w.entries, 2, "forged")) {
      await w.overwrite(entry);
    }
    // Every hash and every link is consistent now. Only the digest remembers the old chain.
    expect((await audit(w.journal, w.digests, w.ledger)).findings).toEqual([
      { kind: "digest_mismatch", seq: 4, versionId: "v1" },
    ]);
  });
  // #endregion rewrite

  it("detects a changed timestamp", async () => {
    const w = await world();
    await w.overwrite({ ...(w.entries[2] as Entry), at: at(59).toISOString() });
    expect(kinds(await audit(w.journal, w.digests, w.ledger))).toEqual(["content_changed"]);
  });
});

describe("removal and reordering", () => {
  it("detects an entry removed from the middle", async () => {
    const w = await world();
    await w.erase(3);
    expect((await audit(w.journal, w.digests, w.ledger)).findings).toEqual([
      { kind: "out_of_sequence", expected: 3, found: 4 },
      { kind: "broken_link", seq: 4 },
    ]);
  });

  it("detects two entries that changed places", async () => {
    const w = await world();
    const [second, third] = [w.entries[1] as Entry, w.entries[2] as Entry];
    await w.overwrite({ ...third, seq: 2 });
    await w.overwrite({ ...second, seq: 3 });
    expect(kinds(await audit(w.journal, w.digests, w.ledger))).toEqual([
      "content_changed",
      "broken_link",
      "content_changed",
      "broken_link",
      "broken_link",
    ]);
  });

  it("detects a first entry that was removed", async () => {
    const w = await world();
    await w.erase(1);
    expect(kinds(await audit(w.journal, w.digests, w.ledger))).toEqual([
      "out_of_sequence",
      "broken_link",
    ]);
  });

  it("detects an end cut off below the digest", async () => {
    const w = await world();
    for (const seq of [4, 5, 6]) {
      await w.erase(seq);
    }
    expect((await audit(w.journal, w.digests, w.ledger)).findings).toEqual([
      { kind: "truncated", seq: 4, tail: 3 },
    ]);
  });

  it("detects a row that is no longer an entry", async () => {
    const w = await world();
    await w.table.write({
      kind: "put",
      item: { pk: "LEDGER#notes", sk: "ENTRY#000000000002", note: "nothing to see" },
    });
    expect(kinds(await audit(w.journal, w.digests, w.ledger))).toEqual(["unreadable"]);
  });
});

// #region window
describe("what no digest covers yet", () => {
  it("cannot detect entries cut off after the newest digest", async () => {
    const w = await world();
    await w.erase(6);
    await w.erase(5);
    expect(await audit(w.journal, w.digests, w.ledger)).toMatchObject({
      entries: 4,
      uncovered: 0,
      findings: [],
    });
  });

  it("cannot detect a consistent rewrite of entries after the newest digest", async () => {
    const w = await world();
    for (const entry of rewrittenFrom(w.entries, 5, "forged")) {
      await w.overwrite(entry);
    }
    expect((await audit(w.journal, w.digests, w.ledger)).findings).toEqual([]);
  });
});
// #endregion window

describe("attacks on the digest itself", () => {
  const forge = async (w: Awaited<ReturnType<typeof world>>) => {
    const forged = rewrittenFrom(w.entries, 2, "forged");
    for (const entry of forged) {
      await w.overwrite(entry);
    }
    return forged;
  };
  const forgedDigest = (forged: Entry[]) => {
    const fourth = forged[2] as Entry;
    return JSON.stringify({ ledger: "notes", seq: 4, hash: fourth.hash, at: at(5).toISOString() });
  };

  it("still detects the rewrite when a matching digest is put on top of the locked one", async () => {
    const w = await world();
    const forged = await forge(w);
    w.digests.overwrite(digestKey(w.ledger, 4), forgedDigest(forged));
    // The new version agrees with the forged chain. The version under it does not.
    expect((await audit(w.journal, w.digests, w.ledger)).findings).toEqual([
      { kind: "digest_mismatch", seq: 4, versionId: "v1" },
    ]);
  });

  it("reports a delete marker over a digest, and still reads the digest under it", async () => {
    const w = await world();
    await forge(w);
    w.digests.remove(digestKey(w.ledger, 4));
    expect(kinds(await audit(w.journal, w.digests, w.ledger)).toSorted()).toEqual([
      "digest_hidden",
      "digest_mismatch",
    ]);
  });

  it("cannot remove a locked version, in either mode, without the bypass", async () => {
    for (const mode of ["governance", "compliance"] as const) {
      const w = await world(mode);
      expect(w.digests.removeVersion(digestKey(w.ledger, 4), "v1")).toBe("locked");
    }
  });

  it("cannot remove a version locked in compliance mode even with the bypass", async () => {
    const w = await world("compliance");
    expect(w.digests.removeVersion(digestKey(w.ledger, 4), "v1", { bypass: true })).toBe("locked");
  });

  // #region governance
  it("loses the proof when governance mode is bypassed: the rewrite is no longer detected", async () => {
    const w = await world("governance");
    const forged = await forge(w);
    expect(w.digests.removeVersion(digestKey(w.ledger, 4), "v1", { bypass: true })).toBe("ok");
    await w.digests.put(digestKey(w.ledger, 4), forgedDigest(forged));
    expect((await audit(w.journal, w.digests, w.ledger)).findings).toEqual([]);
  });
  // #endregion governance

  it("loses the proof once the retention period is over", async () => {
    const w = await world("compliance");
    w.clock.now = new Date(at(5).getTime() + DAY + 1);
    expect(w.digests.removeVersion(digestKey(w.ledger, 4), "v1")).toBe("ok");
  });

  it("reports a digest that cannot be read, or that sits under another entry's name", async () => {
    const w = await world();
    w.digests.overwrite(digestKey(w.ledger, 2), "not json");
    const fourth = await w.digests.get(digestKey(w.ledger, 4), "v1");
    w.digests.overwrite(digestKey(w.ledger, 3), fourth);
    expect(kinds(await audit(w.journal, w.digests, w.ledger))).toEqual([
      "digest_unreadable",
      "digest_unreadable",
    ]);
  });
});

describe("later digests", () => {
  it("covers the newer entries once the next digest is locked", async () => {
    const w = await world();
    await takeDigest(w.journal, w.digests, { ledger: w.ledger, now: at(10) });
    await w.erase(6);
    expect((await audit(w.journal, w.digests, w.ledger)).findings).toEqual([
      { kind: "truncated", seq: 6, tail: 5 },
    ]);
  });
});
