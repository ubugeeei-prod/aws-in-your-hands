import type { Table } from "@aih/example-30-data-modeling/src/table.ts";

import { type Entry, MAX_SEQ, entryKey, ledgerKey, toRow } from "./entry.ts";

// #region journal
/** Where the entries are kept. Rows come back unparsed: reading them is the verifier's job. */
export type Journal = {
  /** Adds the entry unless its sequence number is taken. Never replaces. */
  insert(entry: Entry): Promise<"ok" | "exists">;
  /** The newest row, read with strong consistency. */
  tail(ledger: string): Promise<unknown | undefined>;
  /** Rows with a sequence number above `after`, oldest first. */
  read(ledger: string, after: number, limit: number): Promise<unknown[]>;
};
// #endregion journal

// #region table-journal
/** A journal on chapter 30's table interface: its in-memory model, or DynamoDB through PutItem. */
export function tableJournal(table: Table): Journal {
  const range = (after: number) => ({
    between: [entryKey(after + 1), entryKey(MAX_SEQ)] as [string, string],
  });
  return {
    async insert(entry) {
      const result = await table.write({
        kind: "put",
        item: toRow(entry),
        condition: { kind: "not_exists" },
      });
      return result === "ok" ? "ok" : "exists";
    },
    async tail(ledger) {
      const { items } = await table.query({
        pk: ledgerKey(ledger),
        sk: range(0),
        descending: true,
        limit: 1,
        // An eventually consistent read could miss the entry just written and reuse its number.
        consistent: true,
      });
      return items[0];
    },
    async read(ledger, after, limit) {
      const { items } = await table.query({
        pk: ledgerKey(ledger),
        sk: range(after),
        limit,
        consistent: true,
      });
      return items;
    },
  };
}
// #endregion table-journal
