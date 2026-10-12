import { isDeepStrictEqual } from "node:util";

import {
  type Condition,
  type Item,
  type Key,
  MAX_TRANSACTION_ITEMS,
  type QueryInput,
  type QueryResult,
  type SingleWrite,
  type Table,
  TableValidationError,
  type TransactResult,
  type Write,
  type WriteResult,
} from "./table.ts";

export type IndexDefinition = {
  name: string;
  pk: string;
  sk: string;
  /** Copied into the index beside the keys. Nothing else can be read from it. */
  include: string[];
};

export type StreamRecord = {
  eventId: string;
  sequenceNumber: string;
  eventName: "INSERT" | "MODIFY" | "REMOVE";
  keys: Key;
};

/** Item writes, not capacity units. The two agree while every item is 1 KB or less. */
export type Usage = {
  reads: number;
  writes: number;
  /** DynamoDB bills each of these twice. */
  transactionalWrites: number;
  indexWrites: number;
};

const id = (key: Key): string => `${key.pk}\n${key.sk}`;
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function holds(condition: Condition | undefined, item: Item | undefined): boolean {
  switch (condition?.kind) {
    case undefined:
      return true;
    case "not_exists":
      return item === undefined;
    case "exists":
      return item !== undefined;
    case "equals":
      return item?.[condition.attribute] === condition.value;
    case "missing_or_less_than": {
      const current = item?.[condition.attribute];
      return current === undefined || (typeof current === "number" && current < condition.value);
    }
  }
}

/**
 * A model of one DynamoDB table with at most one global secondary index and a
 * stream. It keeps the rules this chapter depends on (conditions, all-or-nothing
 * transactions, an index that lags, one stream record per change) and nothing
 * else: no capacity, no 1 MB pages, no partitions, no latency.
 */
export class MemoryTable implements Table {
  readonly #items = new Map<string, Item>();
  readonly #indexed = new Map<string, Item>();
  readonly #index: IndexDefinition | undefined;
  #behind: (() => void)[] = [];
  #paused = false;
  #conflicts = 0;
  #sequence = 0;
  readonly stream: StreamRecord[] = [];
  usage: Usage = { reads: 0, writes: 0, transactionalWrites: 0, indexWrites: 0 };

  constructor(index?: IndexDefinition) {
    this.#index = index;
  }

  /** From now on the index stops following the table, until `catchUp`. */
  pauseIndex(): void {
    this.#paused = true;
  }

  catchUp(): void {
    this.#paused = false;
    for (const replicate of this.#behind) {
      replicate();
    }
    this.#behind = [];
  }

  /** The next transaction is cancelled as if another one held one of its items. */
  conflictOnce(): void {
    this.#conflicts++;
  }

  items(): Item[] {
    return [...this.#items.values()].map((item) => structuredClone(item));
  }

  #project(item: Item | undefined): Item | undefined {
    const index = this.#index;
    if (index === undefined || item === undefined) {
      return undefined;
    }
    // Sparse: an item without both key attributes is simply not in the index.
    if (typeof item[index.pk] !== "string" || typeof item[index.sk] !== "string") {
      return undefined;
    }
    const entry: Item = { pk: item.pk, sk: item.sk };
    for (const name of [index.pk, index.sk, ...index.include]) {
      if (item[name] !== undefined) {
        entry[name] = structuredClone(item[name]);
      }
    }
    return entry;
  }

  // #region index-writes
  /** What the developer guide says one table write costs the index. */
  #indexWrites(before: Item | undefined, after: Item | undefined): number {
    const index = this.#index;
    if (index === undefined || (before === undefined && after === undefined)) {
      return 0;
    }
    if (before === undefined || after === undefined) {
      return 1;
    }
    if (before[index.pk] !== after[index.pk] || before[index.sk] !== after[index.sk]) {
      // The entry cannot move: the old one is deleted and a new one is put.
      return 2;
    }
    return isDeepStrictEqual(before, after) ? 0 : 1;
  }
  // #endregion index-writes

  #store(key: Key, next: Item | undefined): void {
    const previous = this.#items.get(id(key));
    if (isDeepStrictEqual(previous, next)) {
      // A write that changes nothing leaves no stream record.
      return;
    }
    if (next === undefined) {
      this.#items.delete(id(key));
    } else {
      this.#items.set(id(key), next);
    }

    const before = this.#project(previous);
    const after = this.#project(next);
    this.usage.indexWrites += this.#indexWrites(before, after);
    const replicate = () => {
      if (after === undefined) {
        this.#indexed.delete(id(key));
      } else {
        this.#indexed.set(id(key), after);
      }
    };
    if (this.#paused) {
      this.#behind.push(replicate);
    } else {
      replicate();
    }

    this.#sequence++;
    this.stream.push({
      eventId: `event-${this.#sequence}`,
      sequenceNumber: String(this.#sequence).padStart(21, "0"),
      eventName: previous === undefined ? "INSERT" : next === undefined ? "REMOVE" : "MODIFY",
      keys: { pk: key.pk, sk: key.sk },
    });
  }

  #apply(write: Write): void {
    switch (write.kind) {
      case "check":
        return;
      case "put":
        this.#store(write.item, structuredClone(write.item));
        return;
      case "delete":
        this.#store(write.key, undefined);
        return;
      case "update": {
        const next: Item = structuredClone(this.#items.get(id(write.key)) ?? { ...write.key });
        for (const [name, value] of Object.entries(write.set ?? {})) {
          next[name] = structuredClone(value);
        }
        for (const [name, amount] of Object.entries(write.add ?? {})) {
          const current = next[name];
          next[name] = (typeof current === "number" ? current : 0) + amount;
        }
        for (const name of write.remove ?? []) {
          delete next[name];
        }
        this.#store(write.key, next);
      }
    }
  }

  #target = (write: Write): Key => (write.kind === "put" ? write.item : write.key);

  async get(key: Key): Promise<Item | undefined> {
    this.usage.reads++;
    return structuredClone(this.#items.get(id(key)));
  }

  async write(write: SingleWrite): Promise<WriteResult> {
    // A refused write is billed too.
    this.usage.writes++;
    if (!holds(write.condition, this.#items.get(id(this.#target(write))))) {
      return "condition_failed";
    }
    this.#apply(write);
    return "ok";
  }

  // #region transact
  async transact(writes: Write[]): Promise<TransactResult> {
    if (writes.length === 0 || writes.length > MAX_TRANSACTION_ITEMS) {
      throw new TableValidationError(
        `A transaction holds 1 to ${MAX_TRANSACTION_ITEMS} items, not ${writes.length}.`,
      );
    }
    const targets = writes.map((write) => id(this.#target(write)));
    if (new Set(targets).size !== targets.length) {
      throw new TableValidationError("Two actions in one transaction name the same item.");
    }
    // Prepared and committed: two writes an item, cancelled or not.
    this.usage.transactionalWrites += writes.length;
    if (this.#conflicts > 0) {
      this.#conflicts--;
      return { ok: false, reasons: writes.map((_, index) => (index === 0 ? "conflict" : "none")) };
    }
    const reasons = writes.map((write) =>
      holds(write.condition, this.#items.get(id(this.#target(write))))
        ? ("none" as const)
        : ("condition_failed" as const),
    );
    if (reasons.some((reason) => reason !== "none")) {
      return { ok: false, reasons };
    }
    for (const write of writes) {
      this.#apply(write);
    }
    return { ok: true };
  }
  // #endregion transact

  async query(input: QueryInput): Promise<QueryResult> {
    this.usage.reads++;
    const index = this.#index;
    const onIndex = input.index !== undefined;
    if (onIndex && input.index !== index?.name) {
      throw new TableValidationError(`The table has no index named ${input.index}.`);
    }
    if (onIndex && input.consistent === true) {
      throw new TableValidationError(
        "Consistent reads are not supported on global secondary indexes.",
      );
    }
    const pkName = onIndex && index !== undefined ? index.pk : "pk";
    const skName = onIndex && index !== undefined ? index.sk : "sk";
    const range = input.sk;
    const within = (value: string): boolean => {
      if (range === undefined) {
        return true;
      }
      return "beginsWith" in range
        ? value.startsWith(range.beginsWith)
        : value >= range.between[0] && value <= range.between[1];
    };
    // Compared by UTF-16 unit, where DynamoDB compares UTF-8 bytes. The same for the ASCII keys used here.
    const order = (item: Item): string[] => [text(item[skName]), item.pk, item.sk];
    const compare = (a: string[], b: string[]): number => {
      for (const [position, value] of a.entries()) {
        const other = b[position] ?? "";
        if (value !== other) {
          return value < other ? -1 : 1;
        }
      }
      return 0;
    };

    let rows = [...(onIndex ? this.#indexed : this.#items).values()]
      .filter((item) => item[pkName] === input.pk && within(text(item[skName])))
      .toSorted((a, b) => compare(order(a), order(b)));
    if (input.descending === true) {
      rows = rows.toReversed();
    }

    const after = input.after;
    if (after !== undefined) {
      const names = onIndex ? ["pk", "sk", pkName, skName] : ["pk", "sk"];
      if (names.some((name) => typeof after[name] !== "string") || after[pkName] !== input.pk) {
        throw new TableValidationError("The provided starting key is invalid.");
      }
      const start = [text(after[skName]), text(after["pk"]), text(after["sk"])];
      rows = rows.filter((item) => {
        const position = compare(order(item), start);
        return input.descending === true ? position < 0 : position > 0;
      });
    }

    const page = input.limit === undefined ? rows : rows.slice(0, input.limit);
    const final = page.at(-1);
    // As in DynamoDB: a page that fills the limit carries a key even when nothing follows it.
    const stopped = input.limit !== undefined && page.length === input.limit;
    return {
      items: page.map((item) => structuredClone(item)),
      ...(stopped && final !== undefined
        ? {
            last: {
              pk: final.pk,
              sk: final.sk,
              ...(onIndex ? { [pkName]: text(final[pkName]), [skName]: text(final[skName]) } : {}),
            },
          }
        : {}),
    };
  }

  async scan(input: { limit: number; after?: Key }): Promise<{ items: Item[]; last?: Key }> {
    this.usage.reads++;
    const start = input.after === undefined ? undefined : id(input.after);
    const rows = [...this.#items.entries()]
      .toSorted(([a], [b]) => (a < b ? -1 : 1))
      .filter(([key]) => start === undefined || key > start)
      .map(([, item]) => item);
    const page = rows.slice(0, input.limit);
    const final = page.at(-1);
    return {
      items: page.map((item) => structuredClone(item)),
      ...(page.length === input.limit && final !== undefined
        ? { last: { pk: final.pk, sk: final.sk } }
        : {}),
    };
  }
}
