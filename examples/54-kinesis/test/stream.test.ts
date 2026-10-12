import { describe, expect, it } from "vite-plus/test";

import { HASH_KEYS, hashKeyOf, SHARD_WRITE_LIMIT } from "../src/local-stream.ts";
import { createLocal } from "../src/local.ts";
import { decode } from "../src/revision.ts";
import { entryOf, noteIn, revision, revisionsOf } from "./fixtures.ts";

// The stream here is the model in src/local-stream.ts. These tests pin the
// model to what the Kinesis documentation says; none of them ran against Kinesis.

const versionsIn = (records: { partitionKey: string; data: Uint8Array }[]) =>
  records.map((record) => {
    const { noteId, version } = decode(record.partitionKey, record.data);
    return `${noteId}@${version}`;
  });

describe("a stream: shards and partition keys", () => {
  it("maps a partition key to a 128-bit hash key with MD5", () => {
    expect(hashKeyOf("a")).toBe(0x0cc175b9c0f1b6a831c399e269772661n);
    expect(hashKeyOf("a")).toBeLessThan(HASH_KEYS);
  });

  it("gives each shard a range of hash keys, and together they cover all of them", () => {
    const { stream } = createLocal({ shards: 2 });
    const [first, second] = stream.shards();
    expect(first?.startingHashKey).toBe(0n);
    expect(second?.startingHashKey).toBe((first?.endingHashKey ?? 0n) + 1n);
    expect(second?.endingHashKey).toBe(HASH_KEYS - 1n);
  });

  it("sends every record of one key to one shard, where they stay in the order they were put", () => {
    const { stream } = createLocal({ shards: 2 });
    const a = noteIn(stream, "shardId-000000000000", "a");
    const b = noteIn(stream, "shardId-000000000001", "b");
    // Interleaved on purpose: the two notes do not share an order, and do not need one.
    for (const version of [1, 2, 3]) {
      stream.putRecords([entryOf(revision(a, version)), entryOf(revision(b, version))]);
    }
    const read = (shardId: string) =>
      versionsIn(stream.read(shardId, { type: "TRIM_HORIZON" }, 100).records);
    expect(read("shardId-000000000000")).toEqual([`${a}@1`, `${a}@2`, `${a}@3`]);
    expect(read("shardId-000000000001")).toEqual([`${b}@1`, `${b}@2`, `${b}@3`]);
  });

  it("orders sequence numbers as integers too large for a number", () => {
    const { stream } = createLocal();
    const { records } = stream.putRecords(revisionsOf("n1", 3).map(entryOf));
    const numbers = records.map((record) =>
      "sequenceNumber" in record ? record.sequenceNumber : "",
    );
    expect(
      numbers
        .map(BigInt)
        .toSorted((a, b) => (a < b ? -1 : 1))
        .map(String),
    ).toEqual(numbers);
    // As numbers, all three are the same value.
    expect(new Set(numbers.map(Number)).size).toBe(1);
  });
});

describe("a stream: records stay, and each reader keeps its own place", () => {
  it("hands the same records to two readers, and reading takes nothing away", () => {
    const { stream } = createLocal();
    stream.putRecords(revisionsOf("n1", 3).map(entryOf));
    const first = stream.read("shardId-000000000000", { type: "TRIM_HORIZON" }, 2);
    const second = stream.read("shardId-000000000000", { type: "TRIM_HORIZON" }, 100);
    expect(versionsIn(first.records)).toEqual(["n1@1", "n1@2"]);
    expect(versionsIn(second.records)).toEqual(["n1@1", "n1@2", "n1@3"]);
    // The first reader goes on from where it stopped, not from where the second is.
    expect(first.next).toBeDefined();
    if (first.next !== undefined) {
      expect(versionsIn(stream.read("shardId-000000000000", first.next, 100).records)).toEqual([
        "n1@3",
      ]);
    }
  });

  it("lets a reader go back: to the oldest record, to a time, or to a sequence number", () => {
    const local = createLocal();
    const { stream } = local;
    const put = (version: number) => {
      const [outcome] = stream.putRecords([entryOf(revision("n1", version))]).records;
      local.advance(60_000);
      return outcome !== undefined && "sequenceNumber" in outcome ? outcome.sequenceNumber : "";
    };
    const start = local.now();
    const sequence = [put(1), put(2), put(3)];
    const read = (position: Parameters<typeof stream.read>[1]) =>
      versionsIn(stream.read("shardId-000000000000", position, 100).records);

    expect(read({ type: "TRIM_HORIZON" })).toEqual(["n1@1", "n1@2", "n1@3"]);
    expect(read({ type: "AT_TIMESTAMP", timestamp: new Date(start.getTime() + 60_000) })).toEqual([
      "n1@2",
      "n1@3",
    ]);
    expect(read({ type: "AT_SEQUENCE_NUMBER", sequenceNumber: sequence[1] ?? "" })).toEqual([
      "n1@2",
      "n1@3",
    ]);
    expect(read({ type: "AFTER_SEQUENCE_NUMBER", sequenceNumber: sequence[1] ?? "" })).toEqual([
      "n1@3",
    ]);
  });

  it("starts a reader at LATEST after everything already in the shard", () => {
    const { stream } = createLocal();
    stream.putRecords(revisionsOf("n1", 2).map(entryOf));
    const latest = stream.read("shardId-000000000000", { type: "LATEST" }, 100);
    expect(latest.records).toEqual([]);
    stream.putRecords([entryOf(revision("n1", 3))]);
    expect(latest.next).toBeDefined();
    if (latest.next !== undefined) {
      expect(versionsIn(stream.read("shardId-000000000000", latest.next, 100).records)).toEqual([
        "n1@3",
      ]);
    }
  });

  it("drops a record when retention runs out, whether anyone read it or not", () => {
    const local = createLocal();
    local.stream.putRecords([entryOf(revision("n1", 1))]);
    local.advance(23 * 60 * 60 * 1000);
    local.stream.putRecords([entryOf(revision("n1", 2))]);
    local.advance(2 * 60 * 60 * 1000);
    expect(
      versionsIn(local.stream.read("shardId-000000000000", { type: "TRIM_HORIZON" }, 100).records),
    ).toEqual(["n1@2"]);
  });
});

describe("a stream: the write limit is per shard", () => {
  // #region hot-key
  it("refuses a hot key's records while the other shard has done nothing", () => {
    const { stream } = createLocal({ shards: 2 });
    const hot = noteIn(stream, "shardId-000000000000", "hot");
    const quiet = noteIn(stream, "shardId-000000000001", "quiet");
    const burst = revisionsOf(hot, SHARD_WRITE_LIMIT.records + 200).map(entryOf);
    // Three requests within one second of the model's clock.
    const results = [burst.slice(0, 500), burst.slice(500, 1000), burst.slice(1000)].map(
      (entries) => stream.putRecords(entries),
    );
    expect(results.map((result) => result.failedRecordCount)).toEqual([0, 0, 200]);
    expect(results[2]?.records.at(-1)).toEqual({
      errorCode: "ProvisionedThroughputExceededException",
    });
    // The stream as a whole is at half its capacity. That does not help the hot shard.
    expect(stream.putRecords([entryOf(revision(quiet, 1))]).failedRecordCount).toBe(0);
  });
  // #endregion hot-key

  it("takes the refused records a second later", () => {
    const local = createLocal();
    const burst = revisionsOf("n1", SHARD_WRITE_LIMIT.records + 1).map(entryOf);
    local.stream.putRecords(burst.slice(0, 500));
    local.stream.putRecords(burst.slice(500, 1000));
    expect(local.stream.putRecords(burst.slice(1000)).failedRecordCount).toBe(1);
    local.advance(1000);
    expect(local.stream.putRecords(burst.slice(1000)).failedRecordCount).toBe(0);
  });

  it("splitting the shard does not help one key: all of it lands in one child", () => {
    const { stream } = createLocal();
    const children = stream.splitShard("shardId-000000000000");
    const child = stream.shardFor("hot");
    expect(children).toContain(child);
    const burst = revisionsOf("hot", SHARD_WRITE_LIMIT.records + 200).map(entryOf);
    const refused = [burst.slice(0, 500), burst.slice(500, 1000), burst.slice(1000)]
      .map((entries) => stream.putRecords(entries).failedRecordCount)
      .reduce((sum, count) => sum + count, 0);
    expect(refused).toBe(200);
  });
});

describe("a stream: a shard split", () => {
  it("closes the parent with its records in it, and routes new records to the children", () => {
    const { stream } = createLocal();
    stream.putRecords(revisionsOf("n1", 2).map(entryOf));
    const [left, right] = stream.splitShard("shardId-000000000000");
    stream.putRecords([entryOf(revision("n1", 3))]);

    const shards = stream.shards();
    expect(shards.map((shard) => [shard.shardId, shard.closed, shard.parentShardId])).toEqual([
      ["shardId-000000000000", true, undefined],
      [left, false, "shardId-000000000000"],
      [right, false, "shardId-000000000000"],
    ]);
    const parent = stream.read("shardId-000000000000", { type: "TRIM_HORIZON" }, 100);
    expect(versionsIn(parent.records)).toEqual(["n1@1", "n1@2"]);
    // Nothing more will come: the end of a closed shard is an end, not "nothing yet".
    expect(parent.next).toBeUndefined();
    expect(
      versionsIn(stream.read(stream.shardFor("n1"), { type: "TRIM_HORIZON" }, 100).records),
    ).toEqual(["n1@3"]);
  });
});
