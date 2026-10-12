// vp run ledger:demo
//
// Appends, locks a digest, appends again, then rewrites history the way someone
// with full access to the table could, and audits. In memory: no AWS, no emulator.

import { MemoryTable } from "@aih/example-30-data-modeling/src/memory-table.ts";

import { audit } from "../src/audit.ts";
import { digestKey, takeDigest } from "../src/digest.ts";
import { type Entry, seal, toRow } from "../src/entry.ts";
import { encodeEvent } from "../src/events.ts";
import { tableJournal } from "../src/journal.ts";
import { append } from "../src/ledger.ts";
import { MemoryDigests } from "../src/memory-digests.ts";

const ledger = "notes";
const minute = (n: number) => new Date(Date.UTC(2026, 9, 13, 9, n));
const table = new MemoryTable();
const journal = tableJournal(table);
const digests = new MemoryDigests({
  mode: "governance",
  retentionMs: 24 * 60 * 60 * 1000,
  now: () => minute(30),
});

const short = (hash: string) => hash.slice(0, 12);
const show = (entry: Entry) =>
  console.log(
    `  ${entry.seq}  prev ${short(entry.prev)}  hash ${short(entry.hash)}  ${entry.event}`,
  );
const report = async (title: string) => {
  const result = await audit(journal, digests, ledger);
  console.log(`\n${title}`);
  console.log(
    `  entries ${result.entries}, digests ${result.digests}, not yet covered ${result.uncovered}`,
  );
  console.log(result.findings.length === 0 ? "  no findings" : "  findings:");
  for (const finding of result.findings) {
    console.log(`    ${JSON.stringify(finding)}`);
  }
};

const entries: Entry[] = [];
const write = async (from: number, to: number) => {
  for (let version = from; version <= to; version++) {
    const event = encodeEvent({ type: "note.updated", noteId: "n1", actor: "user-1", version });
    const entry = await append(journal, { ledger, event, now: minute(version) });
    entries.push(entry);
    show(entry);
  }
};

console.log("append 1 to 4");
await write(1, 4);

const first = await takeDigest(journal, digests, { ledger, now: minute(5) });
console.log(`\ndigest: ${JSON.stringify(first)}`);

console.log("\nappend 5 and 6");
await write(5, 6);
await report("audit, untouched");

// Entry 2 gets another actor, and every hash after it is recomputed to match.
let prev = (entries[0] as Entry).hash;
for (const entry of entries.slice(1)) {
  const event =
    entry.seq === 2
      ? encodeEvent({ type: "note.updated", noteId: "n1", actor: "someone-else", version: 2 })
      : entry.event;
  const forged = seal({ ...entry, event, prev });
  await table.write({ kind: "put", item: toRow(forged) });
  prev = forged.hash;
}
await report("audit, after entries 2 to 6 were rewritten consistently");

const locked = digests.removeVersion(digestKey(ledger, 4), "v1");
console.log(`\ndelete the digest version, without the bypass permission: ${locked}`);
