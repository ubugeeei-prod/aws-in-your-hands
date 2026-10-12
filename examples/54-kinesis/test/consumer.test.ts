import { describe, expect, it } from "vite-plus/test";

import type { LogEntry } from "@aih/example-05-dynamodb/src/log.ts";

import { createBatchHandler } from "../src/consumer.ts";
import { type HistoryStore, InMemoryHistoryStore } from "../src/history.ts";
import { toEvent } from "../src/local-poller.ts";
import type { StoredRecord } from "../src/local-stream.ts";
import type { Entry } from "../src/producer.ts";
import { decode, PoisonRecordError } from "../src/revision.ts";
import { entryOf, poison, revision, revisionsOf } from "./fixtures.ts";

// Records as a shard would hold them, numbered 101, 102, ... in the order given.
const records = (entries: Entry[]): StoredRecord[] =>
  entries.map((entry, index) => ({
    shardId: "shardId-000000000000",
    sequenceNumber: String(101 + index),
    partitionKey: entry.partitionKey,
    data: entry.data,
    approximateArrivalTimestamp: new Date(Date.UTC(2026, 9, 13, 0, 0, index)),
  }));

function setup(store: HistoryStore = new InMemoryHistoryStore()) {
  const logs: LogEntry[] = [];
  return { store, logs, handle: createBatchHandler({ store, log: (entry) => logs.push(entry) }) };
}

describe("decode", () => {
  it("reads back what encode wrote", () => {
    const entry = entryOf(revision("n1", 2));
    expect(decode(entry.partitionKey, entry.data)).toEqual(revision("n1", 2));
  });

  it("calls a record poison when no retry could make it a revision", () => {
    const valid = entryOf(revision("n1", 1));
    const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    for (const [partitionKey, data] of [
      ["n1", new TextEncoder().encode("{not json")],
      ["n1", new Uint8Array([0xff, 0xfe])],
      ["n1", text({ ...revision("n1", 1), version: 0 })],
      ["n1", text({ ...revision("n1", 1), version: 1.5 })],
      ["n1", text({ ...revision("n1", 1), kind: "renamed" })],
      ["n1", text([])],
      // A revision of n1 filed under n2 sits in a shard that orders n2's records, not n1's.
      ["n2", valid.data],
    ] as const) {
      expect(() => decode(partitionKey, data)).toThrow(PoisonRecordError);
    }
  });
});

describe("the consumer's handler", () => {
  it("applies a batch in the order it arrives and reports nothing", async () => {
    const { handle, store, logs } = setup();
    const response = await handle(toEvent(records(revisionsOf("n1", 3).map(entryOf))));
    expect(response).toEqual({ batchItemFailures: [] });
    expect(await store.get("n1")).toMatchObject({ version: 3, revisions: 3 });
    expect(logs.at(-1)).toMatchObject({ message: "batch applied", applied: 3, stale: 0 });
  });

  it("applies a batch it has already applied without changing anything", async () => {
    const { handle, store, logs } = setup();
    const event = toEvent(records(revisionsOf("n1", 3).map(entryOf)));
    await handle(event);
    expect(await handle(event)).toEqual({ batchItemFailures: [] });
    expect(await store.get("n1")).toMatchObject({ version: 3, revisions: 3 });
    expect(logs.at(-1)).toMatchObject({ applied: 0, stale: 3 });
  });

  it("stops at a poison record and names it: what is before is applied, what is after is not", async () => {
    const { handle, store, logs } = setup();
    const event = toEvent(
      records([entryOf(revision("a", 1)), poison(), entryOf(revision("a", 2))]),
    );
    expect(await handle(event)).toEqual({ batchItemFailures: [{ itemIdentifier: "102" }] });
    expect(await store.get("a")).toMatchObject({ version: 1, revisions: 1 });
    expect(logs.at(-1)).toMatchObject({
      level: "error",
      message: "poison record",
      sequenceNumber: "102",
      eventId: "shardId-000000000000:102",
    });
  });

  it("names the record at which the store failed, the same way", async () => {
    const inner = new InMemoryHistoryStore();
    let calls = 0;
    const flaky: HistoryStore = {
      apply: async (value) => {
        calls += 1;
        if (calls === 2) {
          throw new Error("throttled");
        }
        return inner.apply(value);
      },
      applyBlindly: (value) => inner.applyBlindly(value),
      get: (noteId) => inner.get(noteId),
    };
    const { handle, logs } = setup(flaky);
    const event = toEvent(records(revisionsOf("n1", 3).map(entryOf)));
    expect(await handle(event)).toEqual({ batchItemFailures: [{ itemIdentifier: "102" }] });
    expect(logs.at(-1)).toMatchObject({ message: "record not applied", reason: "throttled" });
    // Lambda brings back 102 and 103. Nothing is applied twice.
    expect(await handle(toEvent(records(revisionsOf("n1", 3).map(entryOf)).slice(1)))).toEqual({
      batchItemFailures: [],
    });
    expect(await inner.get("n1")).toMatchObject({ version: 3, revisions: 3 });
  });

  it("throws on an event that is not from a stream, so the whole batch is retried", async () => {
    const { handle } = setup();
    await expect(handle({ Records: [{ body: "an SQS message" }] })).rejects.toThrow();
    await expect(handle({})).rejects.toThrow();
  });
});
