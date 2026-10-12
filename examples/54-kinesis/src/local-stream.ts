import { createHash } from "node:crypto";

// A model of a data stream for tests and the demo: shards that own ranges of
// hash keys, records that stay until retention runs out, readers that each
// keep their own position, a write limit per shard, and a shard split. Each
// rule it implements is one the Kinesis documentation states; the comments
// say where it had to choose for itself. It is not Kinesis.

// #region hash
export const HASH_KEYS = 2n ** 128n;

/** MD5 of the partition key as a 128-bit integer, as the documentation describes. UTF-8 is assumed. */
export const hashKeyOf = (partitionKey: string): bigint =>
  BigInt(`0x${createHash("md5").update(partitionKey, "utf8").digest("hex")}`);
// #endregion hash

// #region types
export type StoredRecord = {
  shardId: string;
  /** A decimal string far beyond what a number holds. Compare with BigInt. */
  sequenceNumber: string;
  partitionKey: string;
  data: Uint8Array;
  approximateArrivalTimestamp: Date;
};

export type ShardInfo = {
  shardId: string;
  startingHashKey: bigint;
  endingHashKey: bigint;
  parentShardId: string | undefined;
  /** A closed shard takes no more records. What it holds can still be read. */
  closed: boolean;
};

export type Position =
  | { type: "TRIM_HORIZON" }
  | { type: "LATEST" }
  | { type: "AT_TIMESTAMP"; timestamp: Date }
  | { type: "AT_SEQUENCE_NUMBER"; sequenceNumber: string }
  | { type: "AFTER_SEQUENCE_NUMBER"; sequenceNumber: string };

export type PutEntry = { partitionKey: string; data: Uint8Array };
export type PutOutcome =
  | { shardId: string; sequenceNumber: string }
  | { errorCode: "ProvisionedThroughputExceededException" | "InternalFailure" };
export type PutRecordsResult = { failedRecordCount: number; records: PutOutcome[] };

export type ReadResult = {
  records: StoredRecord[];
  /** Where to read next. Undefined when the shard is closed and nothing is left in it. */
  next: Position | undefined;
  millisBehindLatest: number;
};
// #endregion types

/** One second of writes a shard accepts: 1,000 records or 1 MiB, whichever comes first. */
export const SHARD_WRITE_LIMIT = { records: 1000, bytes: 1024 * 1024 } as const;

type Shard = ShardInfo & {
  records: StoredRecord[];
  window: { second: number; records: number; bytes: number };
};

export class LocalStream {
  readonly #now: () => Date;
  readonly #retentionMs: number;
  readonly #shards: Shard[] = [];
  // Starts where the documentation's examples are, so no test can treat one as a number.
  #sequence = 49_590_338_271_490_256_608_559_692_538_361_571_095_921_575_989_136_588_898n;
  #puts = 0;
  #reject: ((entry: PutEntry, index: number) => boolean) | undefined;

  constructor(options: { shards: number; now: () => Date; retentionHours?: number }) {
    this.#now = options.now;
    this.#retentionMs = (options.retentionHours ?? 24) * 60 * 60 * 1000;
    const width = HASH_KEYS / BigInt(options.shards);
    for (let index = 0; index < options.shards; index += 1) {
      const last = index === options.shards - 1;
      this.#open(BigInt(index) * width, last ? HASH_KEYS - 1n : BigInt(index + 1) * width - 1n);
    }
  }

  shards(): ShardInfo[] {
    return this.#shards.map(
      ({ shardId, startingHashKey, endingHashKey, parentShardId, closed }) => ({
        shardId,
        startingHashKey,
        endingHashKey,
        parentShardId,
        closed,
      }),
    );
  }

  /** The open shard whose range holds the key's hash. */
  shardFor(partitionKey: string): string {
    const hash = hashKeyOf(partitionKey);
    const shard = this.#shards.find(
      (candidate) =>
        !candidate.closed && candidate.startingHashKey <= hash && hash <= candidate.endingHashKey,
    );
    if (shard === undefined) {
      throw new Error(`no open shard for hash key ${hash}`);
    }
    return shard.shardId;
  }

  // #region put
  /** Each entry is accepted or refused by itself, and a refusal does not stop the ones after it. */
  putRecords(entries: PutEntry[]): PutRecordsResult {
    const records = entries.map((entry, index): PutOutcome => {
      if (this.#reject?.(entry, index) === true) {
        return { errorCode: "InternalFailure" };
      }
      const shard = this.#shard(this.shardFor(entry.partitionKey));
      const size = entry.data.byteLength + Buffer.byteLength(entry.partitionKey);
      // The documentation gives the limit per second. Counting within each
      // whole second of the clock is this model's choice.
      const second = Math.floor(this.#now().getTime() / 1000);
      if (shard.window.second !== second) {
        shard.window = { second, records: 0, bytes: 0 };
      }
      if (
        shard.window.records + 1 > SHARD_WRITE_LIMIT.records ||
        shard.window.bytes + size > SHARD_WRITE_LIMIT.bytes
      ) {
        return { errorCode: "ProvisionedThroughputExceededException" };
      }
      shard.window.records += 1;
      shard.window.bytes += size;
      // Increasing, never consecutive: nothing may count on "the next number".
      this.#puts += 1;
      this.#sequence += 1n + BigInt(this.#puts % 5);
      const sequenceNumber = this.#sequence.toString();
      shard.records.push({
        shardId: shard.shardId,
        sequenceNumber,
        partitionKey: entry.partitionKey,
        data: entry.data,
        approximateArrivalTimestamp: this.#now(),
      });
      return { shardId: shard.shardId, sequenceNumber };
    });
    this.#reject = undefined;
    return {
      failedRecordCount: records.filter((record) => "errorCode" in record).length,
      records,
    };
  }

  /** Makes the next putRecords call refuse the entries the predicate picks, as an internal failure. */
  rejectNext(predicate: (entry: PutEntry, index: number) => boolean): void {
    this.#reject = predicate;
  }
  // #endregion put

  // #region read
  /** Reads forward from a position. Reading removes nothing, and no reader sees another. */
  read(shardId: string, position: Position, limit: number): ReadResult {
    const shard = this.#shard(shardId);
    const horizon = this.#now().getTime() - this.#retentionMs;
    const kept = shard.records.filter(
      (record) => record.approximateArrivalTimestamp.getTime() >= horizon,
    );
    const after = this.#after(shard, kept, position);
    const ahead = kept.filter((record) => BigInt(record.sequenceNumber) > after);
    const records = ahead.slice(0, limit);
    const last = records.at(-1);
    const tip = kept.at(-1);
    const exhausted = records.length === ahead.length;
    return {
      records,
      next:
        shard.closed && exhausted
          ? undefined
          : {
              type: "AFTER_SEQUENCE_NUMBER",
              sequenceNumber: (last?.sequenceNumber ?? after).toString(),
            },
      millisBehindLatest:
        exhausted || tip === undefined || last === undefined
          ? 0
          : tip.approximateArrivalTimestamp.getTime() - last.approximateArrivalTimestamp.getTime(),
    };
  }

  #after(shard: Shard, kept: StoredRecord[], position: Position): bigint {
    switch (position.type) {
      case "TRIM_HORIZON":
        return -1n;
      case "LATEST":
        return BigInt(shard.records.at(-1)?.sequenceNumber ?? -1n);
      case "AT_TIMESTAMP": {
        const first = kept.find(
          (record) => record.approximateArrivalTimestamp >= position.timestamp,
        );
        return first === undefined
          ? BigInt(kept.at(-1)?.sequenceNumber ?? -1n)
          : BigInt(first.sequenceNumber) - 1n;
      }
      case "AT_SEQUENCE_NUMBER":
        return BigInt(position.sequenceNumber) - 1n;
      case "AFTER_SEQUENCE_NUMBER":
        return BigInt(position.sequenceNumber);
    }
  }
  // #endregion read

  // #region split
  /** Closes a shard and opens two children that share its range. What the parent holds stays in it. */
  splitShard(shardId: string): [string, string] {
    const parent = this.#shard(shardId);
    if (parent.closed) {
      throw new Error(`${shardId} is already closed`);
    }
    parent.closed = true;
    const middle = (parent.startingHashKey + parent.endingHashKey) / 2n;
    return [
      this.#open(parent.startingHashKey, middle, shardId),
      this.#open(middle + 1n, parent.endingHashKey, shardId),
    ];
  }
  // #endregion split

  #open(startingHashKey: bigint, endingHashKey: bigint, parentShardId?: string): string {
    const shardId = `shardId-${String(this.#shards.length).padStart(12, "0")}`;
    this.#shards.push({
      shardId,
      startingHashKey,
      endingHashKey,
      parentShardId,
      closed: false,
      records: [],
      window: { second: -1, records: 0, bytes: 0 },
    });
    return shardId;
  }

  #shard(shardId: string): Shard {
    const shard = this.#shards.find((candidate) => candidate.shardId === shardId);
    if (shard === undefined) {
      throw new Error(`no shard named ${shardId}`);
    }
    return shard;
  }
}
