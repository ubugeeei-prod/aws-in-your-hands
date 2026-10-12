// The part of DynamoDB this chapter uses, as types. Two things implement it:
// dynamodb-table.ts (the SDK) and memory-table.ts (a model for tests).

// #region items
export type Key = { pk: string; sk: string };
export type Item = Key & Record<string, unknown>;
// #endregion items

// #region writes
export type Condition =
  /** No item has this key. */
  | { kind: "not_exists" }
  | { kind: "exists" }
  | { kind: "equals"; attribute: string; value: string | number }
  /** For a counter that may not have been written yet. */
  | { kind: "missing_or_less_than"; attribute: string; value: number };

export type Put = { kind: "put"; item: Item; condition?: Condition };
export type Update = {
  kind: "update";
  key: Key;
  set?: Record<string, unknown>;
  /** Adds to a number, creating it when the item or the attribute is missing. */
  add?: Record<string, number>;
  remove?: string[];
  condition?: Condition;
};
export type Delete = { kind: "delete"; key: Key; condition?: Condition };
/** Changes nothing. Only inside a transaction: the others happen only if this holds. */
export type Check = { kind: "check"; key: Key; condition: Condition };

export type SingleWrite = Put | Update | Delete;
export type Write = SingleWrite | Check;
// #endregion writes

// #region results
export type WriteResult = "ok" | "condition_failed";

/** One per write, in the order given. `conflict`: another transaction held the item. */
export type Reason = "none" | "condition_failed" | "conflict";
export type TransactResult = { ok: true } | { ok: false; reasons: Reason[] };
// #endregion results

// #region query
export type QueryInput = {
  /** Omitted: the table, by pk and sk. Given: that index, by its own two key attributes. */
  index?: string;
  pk: string;
  sk?: { beginsWith: string } | { between: [string, string] };
  descending?: boolean;
  limit?: number;
  /** Where the previous page stopped. Every key attribute of the table, and of the index if one is used. */
  after?: Record<string, string>;
  /** Not available on a global secondary index. */
  consistent?: boolean;
};
export type QueryResult = { items: Item[]; last?: Record<string, string> };

export type Table = {
  get(key: Key, options?: { consistent?: boolean }): Promise<Item | undefined>;
  query(input: QueryInput): Promise<QueryResult>;
  write(write: SingleWrite): Promise<WriteResult>;
  /** All of them or none. At most 100, and no two on the same item. */
  transact(writes: Write[]): Promise<TransactResult>;
  /** The whole table, in no useful order. For migrations, never for a request. */
  scan(input: { limit: number; after?: Key }): Promise<{ items: Item[]; last?: Key }>;
};
// #endregion query

export const MAX_TRANSACTION_ITEMS = 100;

/** A request DynamoDB refuses outright, whatever the data. */
export class TableValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableValidationError";
  }
}
