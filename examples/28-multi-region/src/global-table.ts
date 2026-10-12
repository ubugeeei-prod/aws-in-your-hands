// A global table, in memory. It follows what the DynamoDB documentation says
// about the two consistency modes and nothing more: no latency, no throttling,
// no partial failure inside a Region.

export type Item = Record<string, unknown>;

/** Checked against the copy in the Region that received the write. */
export type Condition = (current: Item | undefined) => boolean;

export type ConsistencyMode = "eventual" | "strong";

export type WriteResult = "written" | "condition_failed";

// #region replica
/** What a function in one Region can do: it talks to the copy in its own Region only. */
export type Replica = {
  readonly region: string;
  /**
   * A strongly consistent read. In eventual mode it still answers from the local
   * copy, which may be behind another Region's.
   */
  get(key: string): Item | undefined;
  /** An eventually consistent read: the local copy as it is, even when the Region is cut off. */
  getEventually(key: string): Item | undefined;
  put(key: string, item: Item, condition?: Condition): WriteResult;
  delete(key: string, condition?: Condition): WriteResult;
  /** Keys that start with the prefix, in key order. */
  query(prefix: string): Item[];
};
// #endregion replica

/** Strong mode only: the Region cannot reach a second Region, so it refuses to write. */
export class RegionIsolatedError extends Error {
  constructor(region: string) {
    super(`${region} cannot reach another Region of the table.`);
    this.name = "RegionIsolatedError";
  }
}

// `at` and `sequence` stand in for DynamoDB's private per-item timestamp.
type Stamp = { at: number; sequence: number };
type Stored = { item: Item | undefined; stamp: Stamp };
type InFlight = { from: string; to: string; key: string; stored: Stored; dueAt: number };

const newer = (a: Stamp, b: Stamp): boolean =>
  a.at > b.at || (a.at === b.at && a.sequence > b.sequence);

export type GlobalTableOptions = {
  mode: ConsistencyMode;
  /** Regions that hold a copy. */
  replicas: readonly string[];
  /** Strong mode: a Region that only helps two replicas agree. It holds nothing a function can read. */
  witness?: string | undefined;
  /** Eventual mode: how long a write takes to reach the other Regions. */
  lagMs?: number | undefined;
};

export class GlobalTableModel {
  readonly mode: ConsistencyMode;
  readonly #copies = new Map<string, Map<string, Stored>>();
  readonly #members: string[];
  readonly #isolated = new Set<string>();
  readonly #lagMs: number;
  #inFlight: InFlight[] = [];
  #now = 0;
  #sequence = 0;

  constructor(options: GlobalTableOptions) {
    this.mode = options.mode;
    this.#lagMs = options.lagMs ?? 1000;
    for (const region of options.replicas) {
      this.#copies.set(region, new Map());
    }
    this.#members = [
      ...options.replicas,
      ...(options.witness === undefined ? [] : [options.witness]),
    ];
    if (options.mode === "strong" && this.#members.length !== 3) {
      throw new Error("A strongly consistent global table spans exactly three Regions.");
    }
  }

  get now(): number {
    return this.#now;
  }

  /** Cuts a Region off from every other Region. Functions inside it keep running. */
  isolate(region: string): void {
    this.#isolated.add(region);
  }

  rejoin(region: string): void {
    this.#isolated.delete(region);
    if (this.mode === "strong") {
      this.#catchUp(region);
    }
    this.#deliver();
  }

  /** Moves the clock, and delivers what has become due and can get through. */
  advance(ms: number): void {
    this.#now += ms;
    this.#deliver();
  }

  /** Writes accepted somewhere and not yet applied everywhere. */
  get undelivered(): number {
    return this.#inFlight.length;
  }

  replica(region: string): Replica {
    const copy = this.#copy(region);
    const read = (key: string): Item | undefined => {
      const item = copy.get(key)?.item;
      return item === undefined ? undefined : { ...item };
    };
    return {
      region,
      get: (key) => {
        this.#requireQuorum(region);
        return read(key);
      },
      getEventually: read,
      put: (key, item, condition) => this.#write(region, key, { ...item }, condition),
      delete: (key, condition) => this.#write(region, key, undefined, condition),
      query: (prefix) =>
        [...copy.entries()]
          .filter(([key, stored]) => key.startsWith(prefix) && stored.item !== undefined)
          .toSorted(([a], [b]) => (a < b ? -1 : 1))
          .map(([, stored]) => ({ ...stored.item })),
    };
  }

  #copy(region: string): Map<string, Stored> {
    const copy = this.#copies.get(region);
    if (copy === undefined) {
      throw new Error(`${region} holds no replica of this table.`);
    }
    return copy;
  }

  #reachable(a: string, b: string): boolean {
    return !this.#isolated.has(a) && !this.#isolated.has(b);
  }

  // Strong mode: a write returns only after a second Region has it, and a
  // consistent read needs the same agreement. Alone, the Region refuses both.
  #requireQuorum(region: string): void {
    if (
      this.mode === "strong" &&
      !this.#members.some((other) => other !== region && this.#reachable(region, other))
    ) {
      throw new RegionIsolatedError(region);
    }
  }

  #write(
    region: string,
    key: string,
    item: Item | undefined,
    condition: Condition | undefined,
  ): WriteResult {
    const copy = this.#copy(region);
    this.#requireQuorum(region);
    // The condition sees this Region's copy. In strong mode that copy is the
    // latest one; in eventual mode it may be behind another Region's.
    if (condition !== undefined && !condition(copy.get(key)?.item)) {
      return "condition_failed";
    }
    const stored: Stored = { item, stamp: { at: this.#now, sequence: ++this.#sequence } };
    copy.set(key, stored);
    for (const other of this.#copies.keys()) {
      if (other === region) {
        continue;
      }
      if (this.mode === "strong") {
        if (this.#reachable(region, other)) {
          this.#copy(other).set(key, stored);
        }
      } else {
        this.#inFlight.push({
          from: region,
          to: other,
          key,
          stored,
          dueAt: this.#now + this.#lagMs,
        });
      }
    }
    return "written";
  }

  // #region last-writer-wins
  #deliver(): void {
    const waiting: InFlight[] = [];
    for (const message of this.#inFlight) {
      if (message.dueAt > this.#now || !this.#reachable(message.from, message.to)) {
        // Held, not dropped: it is applied when the Regions can talk again.
        waiting.push(message);
        continue;
      }
      const copy = this.#copy(message.to);
      const current = copy.get(message.key);
      // The whole of conflict resolution. An incoming write is applied only if
      // it is newer than what is there; otherwise it disappears without a trace.
      if (current === undefined || newer(message.stored.stamp, current.stamp)) {
        copy.set(message.key, message.stored);
      }
    }
    this.#inFlight = waiting;
  }
  // #endregion last-writer-wins

  /** Strong mode: a Region that was away copies what the others agreed on meanwhile. */
  #catchUp(region: string): void {
    const copy = this.#copy(region);
    for (const [other, source] of this.#copies) {
      if (other === region || this.#isolated.has(other)) {
        continue;
      }
      for (const [key, stored] of source) {
        const current = copy.get(key);
        if (current === undefined || newer(stored.stamp, current.stamp)) {
          copy.set(key, stored);
        }
      }
    }
  }
}
