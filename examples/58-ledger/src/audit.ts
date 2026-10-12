import { type DigestStore, PAGE, digestPrefix, loadDigests } from "./digest.ts";
import { GENESIS } from "./entry.ts";
import type { Journal } from "./journal.ts";
import { type Finding, chainChecker, checkDigests } from "./verify.ts";

// #region audit
export type Audit = {
  entries: number;
  digests: number;
  /** Entries after the newest digest. Nothing locked vouches for them yet. */
  uncovered: number;
  findings: Finding[];
};

/** Reads the whole ledger and every version of every digest. */
export async function audit(journal: Journal, store: DigestStore, ledger: string): Promise<Audit> {
  const chain = chainChecker(ledger, { seq: 0, hash: GENESIS });
  for (;;) {
    const rows = await journal.read(ledger, chain.next() - 1, PAGE);
    chain.push(rows);
    if (rows.length < PAGE) {
      break;
    }
  }
  const tail = chain.next() - 1;
  const stored = await loadDigests(store, digestPrefix(ledger));
  const covered = Math.max(0, ...stored.map((version) => version.digest?.seq ?? 0));
  return {
    entries: chain.hashes.size,
    digests: stored.filter((version) => version.digest !== undefined).length,
    uncovered: Math.max(0, tail - covered),
    findings: [...chain.findings, ...checkDigests(chain.hashes, tail, stored)],
  };
}
// #endregion audit
