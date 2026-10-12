import type { StoredDigest } from "./digest.ts";
import { type Entry, hashOf, toEntry } from "./entry.ts";

// #region findings
export type Finding =
  /** A row that is not an entry at all. */
  | { kind: "unreadable"; position: number }
  /** An entry is missing, or entries changed places. */
  | { kind: "out_of_sequence"; expected: number; found: number }
  /** The entry no longer hashes to the hash stored with it. */
  | { kind: "content_changed"; seq: number }
  /** The entry does not name the hash of the one before it. */
  | { kind: "broken_link"; seq: number }
  /** A locked digest names a hash this ledger does not have at that number. */
  | { kind: "digest_mismatch"; seq: number; versionId: string }
  /** A locked digest names an entry past the end: the end was cut off. */
  | { kind: "truncated"; seq: number; tail: number }
  | { kind: "digest_unreadable"; key: string; versionId: string }
  /** Someone put a delete marker over a digest. The digest itself is still there. */
  | { kind: "digest_hidden"; key: string };
// #endregion findings

// #region chain
/** Where checking starts: after entry `seq`, whose hash is known or not. */
export type Anchor = { seq: number; hash?: string };

export function chainChecker(ledger: string, from: Anchor) {
  const findings: Finding[] = [];
  const hashes = new Map<number, string>();
  let expected = from.seq + 1;
  let previous = from.hash;
  let position = 0;

  return {
    findings,
    hashes,
    next: () => expected,
    /** Checks the rows in the order given and returns the last readable one. */
    push(rows: unknown[]): Entry | undefined {
      let last: Entry | undefined;
      for (const row of rows) {
        position++;
        const entry = toEntry(ledger, row);
        if (entry === undefined) {
          findings.push({ kind: "unreadable", position });
          previous = undefined;
          expected++;
          continue;
        }
        if (entry.seq !== expected) {
          findings.push({ kind: "out_of_sequence", expected, found: entry.seq });
        }
        if (hashOf(entry) !== entry.hash) {
          findings.push({ kind: "content_changed", seq: entry.seq });
        }
        if (previous !== undefined && entry.prev !== previous) {
          findings.push({ kind: "broken_link", seq: entry.seq });
        }
        hashes.set(entry.seq, entry.hash);
        previous = entry.hash;
        expected = entry.seq + 1;
        last = entry;
      }
      return last;
    },
  };
}
// #endregion chain

// #region digests
export function checkDigests(
  hashes: ReadonlyMap<number, string>,
  tail: number,
  stored: StoredDigest[],
): Finding[] {
  return stored.flatMap((version): Finding[] => {
    if (version.deleteMarker) {
      return [{ kind: "digest_hidden", key: version.key }];
    }
    const digest = version.digest;
    if (digest === undefined) {
      return [{ kind: "digest_unreadable", key: version.key, versionId: version.versionId }];
    }
    if (digest.seq > tail) {
      return [{ kind: "truncated", seq: digest.seq, tail }];
    }
    return hashes.get(digest.seq) === digest.hash
      ? []
      : [{ kind: "digest_mismatch", seq: digest.seq, versionId: version.versionId }];
  });
}
// #endregion digests
