import * as v from "valibot";

import { type NoteEvent, noteEventSchema } from "./contract.ts";

// #region counter
export type CounterStore = {
  /** Adds, whatever was added before. */
  add(owner: string, delta: number): Promise<void>;
  /** Adds only if this event has not been counted. Remembering and adding are one step. */
  addOnce(owner: string, eventId: string, delta: number): Promise<"counted" | "already_counted">;
  get(owner: string): Promise<number>;
};

/** How one event moves the number of notes an owner has. */
export const deltaOf = (event: NoteEvent): number =>
  event.type === "NoteCreated" ? 1 : event.type === "NoteDeleted" ? -1 : 0;

// Correct only if every event arrives exactly once. Nothing on the way promises that.
export function createNaiveCounter(store: CounterStore) {
  return async (detail: unknown): Promise<void> => {
    const event = v.parse(noteEventSchema, detail);
    await store.add(event.owner, deltaOf(event));
  };
}

// Adding is not idempotent on its own, so the event's ID is remembered in
// the same step. A second delivery, or a replay, finds the ID and adds nothing.
export function createCounter(store: CounterStore) {
  return async (detail: unknown): Promise<"counted" | "already_counted"> => {
    const event = v.parse(noteEventSchema, detail);
    return store.addOnce(event.owner, event.id, deltaOf(event));
  };
}
// #endregion counter

export class InMemoryCounterStore implements CounterStore {
  readonly #counts = new Map<string, number>();
  readonly #counted = new Set<string>();

  async add(owner: string, delta: number) {
    this.#counts.set(owner, (this.#counts.get(owner) ?? 0) + delta);
  }

  async addOnce(owner: string, eventId: string, delta: number) {
    const marker = `${owner}/${eventId}`;
    // No `await` between the check and the two writes: one step, as the transaction is in DynamoDB.
    if (this.#counted.has(marker)) {
      return "already_counted" as const;
    }
    this.#counted.add(marker);
    this.#counts.set(owner, (this.#counts.get(owner) ?? 0) + delta);
    return "counted" as const;
  }

  async get(owner: string) {
    return this.#counts.get(owner) ?? 0;
  }
}
