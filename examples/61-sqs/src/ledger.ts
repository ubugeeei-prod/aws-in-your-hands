import { type Command, commandKeyOf } from "./command.ts";

// #region port
export type NoteState = { title: string; lines: string[]; applied: number };

/** `refused`: the command is well formed and can never take effect. */
export type ApplyResult = "applied" | "already_applied" | "refused";

export type Ledger = {
  /** Applies the command unless its key was applied before. One step: both or neither. */
  apply(command: Command): Promise<ApplyResult>;
  get(owner: string, noteId: string): Promise<NoteState | undefined>;
};

// A DynamoDB item holds 400 KB. Two hundred lines of 500 characters stay under it.
export const MAX_LINES = 200;
// #endregion port

// #region change
export function change(state: NoteState | undefined, command: Command): NoteState | "full" {
  const before = state ?? { title: "", lines: [], applied: 0 };
  if (command.change.type === "retitle") {
    return { ...before, title: command.change.title, applied: before.applied + 1 };
  }
  if (before.lines.length >= MAX_LINES) {
    return "full";
  }
  return {
    ...before,
    lines: [...before.lines, command.change.line],
    applied: before.applied + 1,
  };
}
// #endregion change

const noteKey = (owner: string, noteId: string): string => `${owner}/${noteId}`;

// #region memory
/** The same contract as the DynamoDB ledger, in two maps. */
export class MemoryLedger implements Ledger {
  readonly #notes = new Map<string, NoteState>();
  readonly #applied = new Set<string>();

  // Nothing is awaited between the check and the two writes, which is what
  // the transaction gives the DynamoDB ledger.
  async apply(command: Command): Promise<ApplyResult> {
    const key = commandKeyOf(command);
    if (this.#applied.has(key)) {
      return "already_applied";
    }
    const note = noteKey(command.owner, command.noteId);
    const next = change(this.#notes.get(note), command);
    if (next === "full") {
      return "refused";
    }
    this.#applied.add(key);
    this.#notes.set(note, next);
    return "applied";
  }

  async get(owner: string, noteId: string): Promise<NoteState | undefined> {
    return this.#notes.get(noteKey(owner, noteId));
  }
}
// #endregion memory
