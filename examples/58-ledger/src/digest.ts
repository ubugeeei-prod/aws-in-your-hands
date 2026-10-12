import * as v from "valibot";

import { type Entry, GENESIS, MAX_SEQ } from "./entry.ts";
import type { Journal } from "./journal.ts";
import { type Finding, chainChecker, checkDigests } from "./verify.ts";

// #region digest
/** The newest entry of a ledger at one moment. Its hash covers every entry before it. */
const digestSchema = v.strictObject({
  ledger: v.string(),
  seq: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MAX_SEQ)),
  hash: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
  at: v.pipe(v.string(), v.isoTimestamp()),
});
export type Digest = v.InferOutput<typeof digestSchema>;

export const digestPrefix = (ledger: string): string => `digests/${ledger}/`;
export const digestKey = (ledger: string, seq: number): string =>
  `${digestPrefix(ledger)}${String(seq).padStart(12, "0")}.json`;

export function parseDigest(key: string, body: string): Digest | undefined {
  try {
    const parsed = v.safeParse(digestSchema, JSON.parse(body));
    // A digest stored under another entry's name is not a digest of that entry.
    return parsed.success && digestKey(parsed.output.ledger, parsed.output.seq) === key
      ? parsed.output
      : undefined;
  } catch {
    return undefined;
  }
}
// #endregion digest

// #region store
export type DigestVersion = { key: string; versionId: string; deleteMarker: boolean };

/** A versioned bucket, seen through the three calls the ledger needs. */
export type DigestStore = {
  /** Writes only when the key has no current object. */
  put(key: string, body: string): Promise<"ok" | "exists">;
  /** Every version of every object under the prefix, delete markers included. */
  list(prefix: string): Promise<DigestVersion[]>;
  get(key: string, versionId: string): Promise<string>;
};
// #endregion store

export type StoredDigest = DigestVersion & { digest: Digest | undefined };

export async function loadDigests(store: DigestStore, prefix: string): Promise<StoredDigest[]> {
  const versions = await store.list(prefix);
  return Promise.all(
    versions.map(async (version) => ({
      ...version,
      digest: version.deleteMarker
        ? undefined
        : parseDigest(version.key, await store.get(version.key, version.versionId)),
    })),
  );
}

export const PAGE = 500;

// #region take-digest
export type DigestResult =
  | { kind: "empty" }
  | { kind: "unchanged"; seq: number }
  | { kind: "written"; digest: Digest }
  | { kind: "refused"; findings: Finding[] };

export async function takeDigest(
  journal: Journal,
  store: DigestStore,
  input: { ledger: string; now: Date },
): Promise<DigestResult> {
  const stored = await loadDigests(store, digestPrefix(input.ledger));
  // Keys are zero-padded, so the greatest key is the newest digest.
  const newestKey = stored
    .map((version) => version.key)
    .toSorted()
    .at(-1);
  const newest = stored.filter((version) => version.key === newestKey);
  const anchor = newest.find((version) => version.digest !== undefined)?.digest;

  // Only what was appended since the last digest is read, starting at the entry it names.
  const chain = chainChecker(
    input.ledger,
    anchor === undefined ? { seq: 0, hash: GENESIS } : { seq: anchor.seq - 1 },
  );
  let tail: Entry | undefined;
  for (;;) {
    const rows = await journal.read(input.ledger, chain.next() - 1, PAGE);
    tail = chain.push(rows) ?? tail;
    if (rows.length < PAGE) {
      break;
    }
  }
  const findings = [...chain.findings, ...checkDigests(chain.hashes, chain.next() - 1, newest)];
  if (findings.length > 0) {
    // Locking the head of a chain that no longer matches would make the damage look approved.
    return { kind: "refused", findings };
  }
  if (tail === undefined) {
    return { kind: "empty" };
  }
  if (tail.seq === anchor?.seq) {
    return { kind: "unchanged", seq: tail.seq };
  }
  const digest: Digest = {
    ledger: input.ledger,
    seq: tail.seq,
    hash: tail.hash,
    at: input.now.toISOString(),
  };
  const written = await store.put(digestKey(input.ledger, tail.seq), JSON.stringify(digest));
  return written === "ok" ? { kind: "written", digest } : { kind: "unchanged", seq: tail.seq };
}
// #endregion take-digest
