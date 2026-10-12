import { describe, expect, it } from "vite-plus/test";

import { MemoryTable } from "@aih/example-30-data-modeling/src/memory-table.ts";

import { GENESIS, entryKey, ledgerKey } from "../src/entry.ts";
import { type Journal, tableJournal } from "../src/journal.ts";
import { BrokenTailError, BusyError, append } from "../src/ledger.ts";
import { describeJournalContract } from "./journal-contract.ts";
import { at, fill, noteEvent } from "./support.ts";

describeJournalContract("in-memory table", async () => tableJournal(new MemoryTable()));

const ledger = "notes";
const input = (version: number) => ({ ledger, event: noteEvent(version), now: at(version) });

describe("append", () => {
  it("starts at 1 from the genesis hash, and chains each entry to the one before", async () => {
    const journal = tableJournal(new MemoryTable());
    const [one, two, three] = await fill(journal, ledger, 1, 3);
    expect(one).toMatchObject({ seq: 1, prev: GENESIS });
    expect(two).toMatchObject({ seq: 2, prev: one?.hash });
    expect(three).toMatchObject({ seq: 3, prev: two?.hash });
  });

  it("gives two writers that read the same tail different numbers", async () => {
    const journal = tableJournal(new MemoryTable());
    await fill(journal, ledger, 1, 1);
    let raced = false;
    // The other writer appends between this writer's read of the tail and its insert.
    const slow: Journal = {
      ...journal,
      async tail(name) {
        const tail = await journal.tail(name);
        if (!raced) {
          raced = true;
          await append(journal, input(2));
        }
        return tail;
      },
    };

    const mine = await append(slow, input(3));

    const rows = await journal.read(ledger, 0, 10);
    expect(rows).toMatchObject([{ seq: 1 }, { seq: 2, event: noteEvent(2) }, { seq: 3 }]);
    expect(mine).toMatchObject({ seq: 3, prev: (rows[1] as { hash: string }).hash });
  });

  it("does not append twice when the insert landed and only its answer was lost", async () => {
    const journal = tableJournal(new MemoryTable());
    let lost = false;
    // What the SDK's own retry looks like from here: the second try finds the first one's item.
    const flaky: Journal = {
      ...journal,
      async insert(entry) {
        const result = await journal.insert(entry);
        if (!lost) {
          lost = true;
          return journal.insert(entry);
        }
        return result;
      },
    };

    const entry = await append(flaky, input(1));

    expect(entry.seq).toBe(1);
    expect(await journal.read(ledger, 0, 10)).toHaveLength(1);
  });

  it("gives up when another writer wins every time", async () => {
    const journal = tableJournal(new MemoryTable());
    let version = 100;
    const crowded: Journal = {
      ...journal,
      async tail(name) {
        const tail = await journal.tail(name);
        await append(journal, input(version++));
        return tail;
      },
    };
    await expect(append(crowded, input(1), 3)).rejects.toBeInstanceOf(BusyError);
    expect(await journal.read(ledger, 0, 10)).toHaveLength(3);
  });

  it("does not chain onto a tail it cannot read", async () => {
    const table = new MemoryTable();
    const journal = tableJournal(table);
    await fill(journal, ledger, 1, 2);
    await table.write({
      kind: "update",
      key: { pk: ledgerKey(ledger), sk: entryKey(2) },
      set: { hash: "gone" },
    });
    await expect(append(journal, input(3))).rejects.toBeInstanceOf(BrokenTailError);
    expect(await journal.read(ledger, 0, 10)).toHaveLength(2);
  });
});
