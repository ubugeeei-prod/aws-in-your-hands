import { createHash } from "node:crypto";

import * as v from "valibot";

// #region entry
export type Entry = {
  ledger: string;
  /** 1 for the first entry, then one more each time. */
  seq: number;
  at: string;
  /** What happened, as the exact text that was hashed. The ledger never parses it. */
  event: string;
  /** The hash of the entry before this one. */
  prev: string;
  hash: string;
};

/** What the first entry names as its predecessor. */
export const GENESIS = "0".repeat(64);
// #endregion entry

// #region seal
// An array of strings and one integer has exactly one JSON text, so the same
// entry always hashes the same. An object would depend on the order of its keys.
export function hashOf(entry: Omit<Entry, "hash">): string {
  const text = JSON.stringify([entry.ledger, entry.seq, entry.at, entry.event, entry.prev]);
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export const seal = (entry: Omit<Entry, "hash">): Entry => ({ ...entry, hash: hashOf(entry) });
// #endregion seal

// #region keys
export const MAX_SEQ = 999_999_999_999;

export const ledgerKey = (ledger: string): string => `LEDGER#${ledger}`;
// Zero-padded, so the order of the sort keys is the order of the numbers.
export const entryKey = (seq: number): string => `ENTRY#${String(seq).padStart(12, "0")}`;
// #endregion keys

const sha256 = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));

// #region row
// A row read back from the table is outside data: someone may have edited it.
const rowSchema = v.object({
  sk: v.string(),
  seq: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MAX_SEQ)),
  at: v.pipe(v.string(), v.isoTimestamp()),
  event: v.string(),
  prev: sha256,
  hash: sha256,
});

export function toEntry(ledger: string, row: unknown): Entry | undefined {
  const parsed = v.safeParse(rowSchema, row);
  if (!parsed.success) {
    return undefined;
  }
  const { sk, ...rest } = parsed.output;
  // The number inside the item must be the one its key says.
  return sk === entryKey(rest.seq) ? { ledger, ...rest } : undefined;
}
// #endregion row

export const toRow = (entry: Entry) => ({
  pk: ledgerKey(entry.ledger),
  sk: entryKey(entry.seq),
  seq: entry.seq,
  at: entry.at,
  event: entry.event,
  prev: entry.prev,
  hash: entry.hash,
});
