// #region ledger
/** Where each owner's spending for a day is kept. Amounts are millionths of a dollar. */
export type UsageLedger = {
  /**
   * Adds `amount` to the owner's day, unless that would pass `limit`. Checking and adding
   * are one step, so two requests at once cannot both take the last of the budget.
   */
  reserve(owner: string, day: string, amount: number, limit: number): Promise<boolean>;
  /** Replaces what was set aside with what was spent. */
  settle(owner: string, day: string, reserved: number, spent: number): Promise<void>;
  spent(owner: string, day: string): Promise<number>;
};

/** The budget's day turns over at midnight UTC. */
export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);
// #endregion ledger

// #region memory
/** One process, no concurrency: this says nothing about DynamoDB under simultaneous writers. */
export class InMemoryUsageLedger implements UsageLedger {
  readonly #days = new Map<string, number>();

  #key = (owner: string, day: string): string => `${owner}/${day}`;

  async reserve(owner: string, day: string, amount: number, limit: number) {
    const used = this.#days.get(this.#key(owner, day)) ?? 0;
    if (used + amount > limit) {
      return false;
    }
    this.#days.set(this.#key(owner, day), used + amount);
    return true;
  }

  async settle(owner: string, day: string, reserved: number, spent: number) {
    const used = this.#days.get(this.#key(owner, day)) ?? 0;
    this.#days.set(this.#key(owner, day), used - reserved + spent);
  }

  async spent(owner: string, day: string) {
    return this.#days.get(this.#key(owner, day)) ?? 0;
  }
}
// #endregion memory
