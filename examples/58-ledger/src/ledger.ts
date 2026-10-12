import { type Entry, GENESIS, seal, toEntry } from "./entry.ts";
import type { Journal } from "./journal.ts";

export class BrokenTailError extends Error {
  constructor(ledger: string) {
    super(`The newest row of ledger ${ledger} is not a readable entry. Nothing was appended.`);
    this.name = "BrokenTailError";
  }
}

export class BusyError extends Error {
  constructor(ledger: string, attempts: number) {
    super(`Ledger ${ledger}: another writer took the next number ${attempts} times in a row.`);
    this.name = "BusyError";
  }
}

// #region append
export async function append(
  journal: Journal,
  input: { ledger: string; event: string; now: Date },
  attempts = 5,
): Promise<Entry> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const row = await journal.tail(input.ledger);
    const tail = row === undefined ? undefined : toEntry(input.ledger, row);
    if (row !== undefined && tail === undefined) {
      // Chaining onto a row that cannot be read would bury the damage under new entries.
      throw new BrokenTailError(input.ledger);
    }
    const entry = seal({
      ledger: input.ledger,
      seq: (tail?.seq ?? 0) + 1,
      at: input.now.toISOString(),
      event: input.event,
      prev: tail?.hash ?? GENESIS,
    });
    if ((await journal.insert(entry)) === "ok") {
      return entry;
    }
    // The number is taken. By this very entry, if an earlier try landed and
    // only its answer was lost; otherwise by another writer, so start again.
    const [taken] = await journal.read(input.ledger, entry.seq - 1, 1);
    if (toEntry(input.ledger, taken)?.hash === entry.hash) {
      return entry;
    }
  }
  throw new BusyError(input.ledger, attempts);
}
// #endregion append
