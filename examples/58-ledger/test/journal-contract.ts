import { describe, expect, it } from "vite-plus/test";

import { GENESIS, seal } from "../src/entry.ts";
import type { Journal } from "../src/journal.ts";
import { at, freshLedger } from "./support.ts";

const entry = (ledger: string, seq: number, event = `event ${seq}`) =>
  seal({ ledger, seq, at: at(seq).toISOString(), event, prev: GENESIS });

/** What the ledger needs from the place its entries are kept, whichever it is. */
export function describeJournalContract(name: string, open: () => Promise<Journal>): void {
  describe(`journal contract: ${name}`, () => {
    it("has no tail before the first entry", async () => {
      const journal = await open();
      expect(await journal.tail(freshLedger())).toBeUndefined();
    });

    it("returns the newest entry as the tail", async () => {
      const journal = await open();
      const ledger = freshLedger();
      for (const seq of [1, 2, 3]) {
        expect(await journal.insert(entry(ledger, seq))).toBe("ok");
      }
      expect(await journal.tail(ledger)).toMatchObject({ seq: 3, hash: entry(ledger, 3).hash });
    });

    it("refuses a number that is taken, and keeps what was there", async () => {
      const journal = await open();
      const ledger = freshLedger();
      await journal.insert(entry(ledger, 1, "the original"));
      expect(await journal.insert(entry(ledger, 1, "a replacement"))).toBe("exists");
      expect(await journal.read(ledger, 0, 10)).toMatchObject([{ event: "the original" }]);
    });

    it("reads the entries above a number, oldest first, up to the limit", async () => {
      const journal = await open();
      const ledger = freshLedger();
      // Inserted out of order: the order read back comes from the keys.
      for (const seq of [3, 1, 4, 2, 5]) {
        await journal.insert(entry(ledger, seq));
      }
      const rows = await journal.read(ledger, 1, 3);
      expect(rows).toMatchObject([{ seq: 2 }, { seq: 3 }, { seq: 4 }]);
    });

    it("keeps ledgers apart", async () => {
      const journal = await open();
      const [one, other] = [freshLedger(), freshLedger()];
      await journal.insert(entry(one, 1));
      expect(await journal.insert(entry(other, 1))).toBe("ok");
      expect(await journal.read(other, 0, 10)).toHaveLength(1);
    });
  });
}
