import { describe, expect, it } from "vite-plus/test";

import { missingOf } from "../src/history.ts";
import { type Handler, LAMBDA_DEFAULTS } from "../src/local-poller.ts";
import { createLocal } from "../src/local.ts";
import { ITERATOR_AGE_ALARM_MS } from "../src/settings.ts";
import { entryOf, noteIn, poison, revision, revisionsOf } from "./fixtures.ts";

// The invariant: for each note, every revision is applied once and in order,
// however often the stream's records are delivered. The mapping here is the
// model in src/local-poller.ts, driving the handler the stack deploys.

const SHARD = "shardId-000000000000";

/** The function does all its work, and the first time Lambda never hears the answer. */
function answerLostOnce(handler: Handler): Handler {
  let lost = false;
  return async (event) => {
    const response = await handler(event);
    if (!lost) {
      lost = true;
      throw new Error("timed out");
    }
    return response;
  };
}

/** A function written before partial batch responses: it throws when a record fails. */
const throwing =
  (handler: Handler): Handler =>
  async (event) => {
    const response = await handler(event);
    if ((response?.batchItemFailures.length ?? 0) > 0) {
      throw new Error("batch failed");
    }
    return response;
  };

describe("at-least-once delivery", () => {
  // #region duplicates
  it("delivers a whole batch again when the function fails after doing its work", async () => {
    const local = createLocal();
    local.stream.putRecords(revisionsOf("n1", 5).map(entryOf));
    const guarded = local.consumer({ wrap: answerLostOnce });
    expect(await guarded.poller.pollShard(SHARD)).toBe("split");
    await guarded.poller.drain();
    // Delivered twice, applied once.
    expect(guarded.logs.filter((entry) => entry.message === "batch applied")).toMatchObject([
      { applied: 5, stale: 0 },
      { applied: 0, stale: 3 },
      { applied: 0, stale: 2 },
    ]);
    expect(await guarded.store.get("n1")).toMatchObject({ version: 5, revisions: 5 });
    expect(guarded.poller.discarded).toEqual([]);
  });

  it("counts every redelivered revision twice in a consumer that applies whatever arrives", async () => {
    const local = createLocal();
    local.stream.putRecords(revisionsOf("n1", 5).map(entryOf));
    const blind = local.consumer({ mode: "blind", wrap: answerLostOnce });
    await blind.poller.drain();
    expect(await blind.store.get("n1")).toMatchObject({ version: 5, revisions: 10 });
  });
  // #endregion duplicates
});

describe("a poison record", () => {
  const fill = (local: ReturnType<typeof createLocal>) => {
    local.stream.putRecords([
      ...revisionsOf("a", 2).map(entryOf),
      poison(),
      ...revisionsOf("b", 2).map(entryOf),
    ]);
  };

  it("with Lambda's defaults, holds back everything behind it in the shard, for as long as it is retained", async () => {
    const local = createLocal({ shards: 2 });
    const stuck = noteIn(local.stream, SHARD, "stuck");
    const free = noteIn(local.stream, "shardId-000000000001", "free");
    local.stream.putRecords([
      { partitionKey: stuck, data: new TextEncoder().encode("{not json") },
      entryOf(revision(stuck, 1)),
      entryOf(revision(free, 1)),
    ]);
    const { store, poller } = local.consumer({
      settings: LAMBDA_DEFAULTS,
      wrap: throwing,
    });
    for (let minute = 0; minute < 60; minute += 1) {
      await poller.pollAll();
      local.advance(60_000);
    }
    expect(await store.get(stuck)).toBeUndefined();
    // The other shard is not held back.
    expect(await store.get(free)).toMatchObject({ version: 1 });
    expect(poller.discarded).toEqual([]);
    // What the alarm watches: the age of the record the mapping is stuck on.
    expect(poller.iteratorAgeMs).toBeGreaterThan(ITERATOR_AGE_ALARM_MS);
  });

  it("with retries alone, is given up on together with every good record of its batch", async () => {
    const local = createLocal();
    fill(local);
    const { store, poller } = local.consumer({
      settings: { bisectBatchOnFunctionError: false, reportBatchItemFailures: false },
      wrap: throwing,
    });
    expect(await poller.drain()).toBe(true);
    // One try and three retries, then the five records are left behind as one.
    expect(poller.discarded).toMatchObject([
      {
        requestContext: { condition: "RetryAttemptsExhausted", approximateInvokeCount: 4 },
        KinesisBatchInfo: { batchSize: 5 },
      },
    ]);
    // "a" was applied before the function threw. "b" never was.
    expect(await store.get("a")).toMatchObject({ version: 2, revisions: 2 });
    expect(await store.get("b")).toBeUndefined();
  });

  it("is skipped without a trace when the function reports it and the mapping was not told to listen", async () => {
    const local = createLocal();
    fill(local);
    const { store, poller } = local.consumer({
      settings: { reportBatchItemFailures: false },
    });
    expect(await poller.pollShard(SHARD)).toBe("succeeded");
    expect(poller.discarded).toEqual([]);
    // Lambda took the answer for a success and moved on. "b" is lost, and nothing says so.
    expect(await store.get("b")).toBeUndefined();
  });

  // #region poison
  it("with the stack's settings, is the only record given up on", async () => {
    const local = createLocal();
    fill(local);
    const { store, poller } = local.consumer();
    expect(await poller.drain()).toBe(true);

    for (const noteId of ["a", "b"]) {
      expect(await store.get(noteId)).toMatchObject({ version: 2, revisions: 2 });
    }
    const [poisoned] = local.stream
      .read(SHARD, { type: "TRIM_HORIZON" }, 100)
      .records.filter((record) => record.partitionKey === "poison");
    expect(poller.discarded).toHaveLength(1);
    expect(poller.discarded[0]).toMatchObject({
      requestContext: { condition: "RetryAttemptsExhausted", approximateInvokeCount: 4 },
      KinesisBatchInfo: {
        shardId: SHARD,
        startSequenceNumber: poisoned?.sequenceNumber,
        endSequenceNumber: poisoned?.sequenceNumber,
        batchSize: 1,
      },
    });
  });
  // #endregion poison

  it("is given up on by age when it has waited longer than the mapping allows", async () => {
    const local = createLocal();
    fill(local);
    const { store, poller } = local.consumer({ settings: { maximumRetryAttempts: -1 } });
    // Up to the poison record, then stuck on it.
    for (let step = 0; step < 20; step += 1) {
      await poller.pollShard(SHARD);
    }
    expect(await store.get("b")).toBeUndefined();
    local.advance(6 * 60 * 60 * 1000 + 1000);
    expect(await poller.pollShard(SHARD)).toBe("discarded");
    expect(poller.discarded[0]?.requestContext.condition).toBe("RecordAgeExceeded");
  });
});

describe("a failure that passes", () => {
  it("is retried from the record that failed, and nothing is given up on", async () => {
    const local = createLocal();
    local.stream.putRecords(revisionsOf("n1", 4).map(entryOf));
    let failures = 2;
    // The table refuses the third revision twice: throttled, say.
    const consumer = local.consumer();
    const original = consumer.store.apply.bind(consumer.store);
    consumer.store.apply = async (value) => {
      if (value.version === 3 && failures > 0) {
        failures -= 1;
        throw new Error("throttled");
      }
      return original(value);
    };
    expect(await consumer.poller.pollShard(SHARD)).toBe("advanced");
    expect(await consumer.poller.drain()).toBe(true);
    expect(await consumer.store.get("n1")).toMatchObject({ version: 4, revisions: 4 });
    expect(consumer.poller.discarded).toEqual([]);
  });
});

describe("a shard split", () => {
  const split = (local: ReturnType<typeof createLocal>) => {
    local.stream.putRecords(revisionsOf("n1", 3).map(entryOf));
    local.stream.splitShard(SHARD);
    local.stream.putRecords([revision("n1", 4), revision("n1", 5)].map(entryOf));
  };

  // #region split
  it("keeps a note's order when the parent is read to its end before the children", async () => {
    const local = createLocal();
    split(local);
    const { store, poller } = local.consumer();
    expect(await poller.pollShard(local.stream.shardFor("n1"))).toBe("waiting-for-parent");
    expect(await poller.drain()).toBe(true);
    expect(await store.get("n1")).toMatchObject({ version: 5, revisions: 5 });
  });

  it("a reader that takes the child first never goes back, and is left three revisions short", async () => {
    const local = createLocal();
    split(local);
    const { store, poller } = local.consumer({ parentsFirst: false });
    await poller.pollShard(local.stream.shardFor("n1"));
    await poller.drain();
    const history = await store.get("n1");
    expect(history).toMatchObject({ version: 5, revisions: 2 });
    expect(history === undefined ? undefined : missingOf(history)).toBe(3);
  });
  // #endregion split
});

describe("several consumers, and reading again", () => {
  it("builds the same history in a consumer added later, from the oldest record", async () => {
    const local = createLocal({ shards: 2 });
    const entries = [...revisionsOf("a", 3), ...revisionsOf("b", 2), revision("b", 3, "deleted")];
    local.stream.putRecords(entries.map(entryOf));
    const first = local.consumer();
    await first.poller.drain();

    local.advance(60 * 60 * 1000);
    const later = local.consumer({ startingPosition: { type: "TRIM_HORIZON" } });
    await later.poller.drain();
    expect(later.store.all()).toEqual(first.store.all());
    expect(await later.store.get("b")).toMatchObject({ version: 3, deleted: true });
  });

  it("a consumer that starts at LATEST never sees what was written before it", async () => {
    const local = createLocal();
    local.stream.putRecords(revisionsOf("n1", 2).map(entryOf));
    const late = local.consumer({ startingPosition: { type: "LATEST" } });
    await late.poller.drain();
    local.stream.putRecords([entryOf(revision("n1", 3))]);
    await late.poller.drain();
    const history = await late.store.get("n1");
    expect(history).toMatchObject({ version: 3, revisions: 1 });
  });

  it("measures how far behind a consumer is by the age of the last record it was handed", async () => {
    const local = createLocal();
    local.stream.putRecords(revisionsOf("n1", 2).map(entryOf));
    local.advance(45 * 60 * 1000);
    const { poller } = local.consumer();
    await poller.pollShard(SHARD);
    expect(poller.iteratorAgeMs).toBe(45 * 60 * 1000);
    expect(poller.iteratorAgeMs).toBeGreaterThan(ITERATOR_AGE_ALARM_MS);

    local.stream.putRecords([entryOf(revision("n1", 3))]);
    await poller.pollShard(SHARD);
    expect(poller.iteratorAgeMs).toBe(0);
  });
});
