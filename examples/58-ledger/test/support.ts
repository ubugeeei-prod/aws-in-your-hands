import { randomUUID } from "node:crypto";

import { MemoryTable } from "@aih/example-30-data-modeling/src/memory-table.ts";

import { takeDigest } from "../src/digest.ts";
import { type Entry, toRow } from "../src/entry.ts";
import { encodeEvent } from "../src/events.ts";
import { type Journal, tableJournal } from "../src/journal.ts";
import { append } from "../src/ledger.ts";
import { MemoryDigests } from "../src/memory-digests.ts";

export const DAY = 24 * 60 * 60 * 1000;

export const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 13, 0, minute));

/** A fresh ledger per test, so tests can share one table. */
export const freshLedger = (): string => `test-${randomUUID()}`;

export const noteEvent = (version: number): string =>
  encodeEvent({ type: "note.updated", noteId: "n1", actor: "user-1", version });

export async function fill(journal: Journal, ledger: string, from: number, to: number) {
  const entries: Entry[] = [];
  for (let version = from; version <= to; version++) {
    entries.push(await append(journal, { ledger, event: noteEvent(version), now: at(version) }));
  }
  return entries;
}

/** Six entries, with a digest locked after the fourth. */
export async function world(mode: "governance" | "compliance" = "governance") {
  const clock = { now: at(0) };
  const table = new MemoryTable();
  const journal = tableJournal(table);
  const digests = new MemoryDigests({ mode, retentionMs: DAY, now: () => clock.now });
  const ledger = "notes";
  const first = await fill(journal, ledger, 1, 4);
  await takeDigest(journal, digests, { ledger, now: at(5) });
  const rest = await fill(journal, ledger, 5, 6);
  const entries = [...first, ...rest];

  return {
    clock,
    table,
    journal,
    digests,
    ledger,
    entries,
    /** What someone with full access to the table can do: replace an item, no questions asked. */
    overwrite: (entry: Entry) => table.write({ kind: "put", item: toRow(entry) }),
    erase: (seq: number) => {
      const { pk, sk } = toRow(entries[seq - 1] as Entry);
      return table.write({ kind: "delete", key: { pk, sk } });
    },
  };
}
