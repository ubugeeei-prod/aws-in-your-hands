import { type Command, parseCommand } from "./command.ts";
import { change, type ApplyResult, type Ledger, type NoteState } from "./ledger.ts";
import type { BatchResponse } from "./worker.ts";

// What not to deploy. The tests and the demo run these next to the real
// worker and ledger, to show which rule each of them is missing.

// #region forgetful
/** Trusts the queue to deliver once: applies whatever arrives. */
export class ForgetfulLedger implements Ledger {
  readonly #notes = new Map<string, NoteState>();

  async apply(command: Command): Promise<ApplyResult> {
    const note = `${command.owner}/${command.noteId}`;
    const next = change(this.#notes.get(note), command);
    if (next === "full") {
      return "refused";
    }
    this.#notes.set(note, next);
    return "applied";
  }

  async get(owner: string, noteId: string): Promise<NoteState | undefined> {
    return this.#notes.get(`${owner}/${noteId}`);
  }
}
// #endregion forgetful

// #region carry-on
/** Chapter 08's handler shape: report the one that failed, and carry on with the rest. */
export function createCarryOnHandler(ledger: Ledger) {
  return async (batch: { Records: { messageId: string; body: string }[] }) => {
    const batchItemFailures: BatchResponse["batchItemFailures"] = [];
    for (const record of batch.Records) {
      try {
        await ledger.apply(parseCommand(record.body));
      } catch {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}
// #endregion carry-on
