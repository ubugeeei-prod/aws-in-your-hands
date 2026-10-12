import { describe, expect, it } from "vite-plus/test";

import { missingOf } from "../src/history.ts";
import { createLocal } from "../src/local.ts";
import {
  type Entry,
  planRounds,
  PutIncompleteError,
  putInOrder,
  putNaively,
  REQUEST_LIMIT,
  type StreamWriter,
} from "../src/producer.ts";
import { decode } from "../src/revision.ts";
import { entryOf, revision, revisionsOf } from "./fixtures.ts";

const SHARD = "shardId-000000000000";
const noWait = { maxAttempts: 3, wait: async () => {} };
const keysOf = (rounds: Entry[][]) => rounds.map((round) => round.map((e) => e.partitionKey));
const stored = (local: ReturnType<typeof createLocal>) =>
  local.stream.read(SHARD, { type: "TRIM_HORIZON" }, 10_000).records.map((record) => {
    const { noteId, version } = decode(record.partitionKey, record.data);
    return `${noteId}@${version}`;
  });
const firstOf = (noteId: string) => (entry: Entry, index: number) =>
  index === 0 && entry.partitionKey === noteId;

describe("planRounds", () => {
  it("never puts two revisions of one note into the same request", () => {
    const entries = [
      revision("a", 1),
      revision("a", 2),
      revision("b", 1),
      revision("a", 3),
      revision("b", 2),
    ].map(entryOf);
    expect(keysOf(planRounds(entries))).toEqual([["a", "b"], ["a", "b"], ["a"]]);
  });

  it("keeps each note's revisions in the order given, across the rounds", () => {
    const entries = [...revisionsOf("a", 3), ...revisionsOf("b", 2)].map(entryOf);
    const flat = planRounds(entries)
      .flat()
      .filter((entry) => entry.partitionKey === "a");
    expect(flat).toEqual(entries.slice(0, 3));
  });

  it("opens another request at 500 records", () => {
    const entries = Array.from({ length: REQUEST_LIMIT.records + 1 }, (_, index) =>
      entryOf(revision(`n${index}`, 1)),
    );
    expect(planRounds(entries).map((round) => round.length)).toEqual([500, 1]);
  });

  it("refuses a record that could not be sent at all", () => {
    const huge = { partitionKey: "a", data: new Uint8Array(REQUEST_LIMIT.bytes) };
    expect(() => planRounds([huge])).toThrow("does not fit");
  });
});

describe("PutRecords and a note's order", () => {
  // #region reorder
  it("resending the refused entries of one request stores a note's revisions out of order", async () => {
    const local = createLocal();
    local.stream.rejectNext(firstOf("n1"));
    await putNaively(local.writer, revisionsOf("n1", 2).map(entryOf));
    expect(stored(local)).toEqual(["n1@2", "n1@1"]);

    // The consumer does not go backwards, so it is left one revision short.
    const { store, poller } = local.consumer();
    await poller.drain();
    const history = await store.get("n1");
    expect(history).toMatchObject({ version: 2, revisions: 1 });
    expect(history === undefined ? undefined : missingOf(history)).toBe(1);
  });

  it("one revision of a note per request keeps the order through the same refusal", async () => {
    const local = createLocal();
    local.stream.rejectNext(firstOf("n1"));
    const { requests } = await putInOrder(local.writer, revisionsOf("n1", 2).map(entryOf), noWait);
    expect(stored(local)).toEqual(["n1@1", "n1@2"]);
    // Two rounds, and the first one twice.
    expect(requests).toBe(3);

    const { store, poller } = local.consumer();
    await poller.drain();
    expect(await store.get("n1")).toMatchObject({ version: 2, revisions: 2 });
  });
  // #endregion reorder

  it("stops at a round it cannot finish, and says what was not sent", async () => {
    const local = createLocal();
    const down: StreamWriter = {
      putRecords: async (entries) =>
        entries[0]?.partitionKey === "a" && entries.length === 1
          ? { records: [{ errorCode: "InternalFailure" }] }
          : local.writer.putRecords(entries),
    };
    // Round 1: a@1 and b@1. Round 2: a@2 alone, which this writer never accepts. Round 3: a@3.
    const entries = [revision("a", 1), revision("b", 1), revision("a", 2), revision("a", 3)].map(
      entryOf,
    );
    const failure = await putInOrder(down, entries, noWait).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PutIncompleteError);
    expect((failure as PutIncompleteError).unsent).toEqual([entries[2], entries[3]]);
    // a@3 was not sent ahead of a@2.
    expect(stored(local)).toEqual(["a@1", "b@1"]);
  });

  it("waits and sends a throttled record again", async () => {
    const local = createLocal();
    // 1,001 notes, one revision each: one more than the shard takes in a second.
    const entries = Array.from({ length: 1001 }, (_, index) => entryOf(revision(`n${index}`, 1)));
    const waits: number[] = [];
    await putInOrder(local.writer, entries, {
      maxAttempts: 3,
      wait: async (attempt) => {
        waits.push(attempt);
        local.advance(1000);
      },
    });
    expect(waits).toEqual([1]);
    expect(stored(local)).toHaveLength(1001);
  });

  it("a request whose answer is lost is sent again, and the stream then holds the record twice", async () => {
    const local = createLocal();
    let lost = false;
    const flaky: StreamWriter = {
      putRecords: async (entries) => {
        const result = await local.writer.putRecords(entries);
        if (!lost) {
          lost = true;
          throw new Error("socket hang up");
        }
        return result;
      },
    };
    const entries = revisionsOf("n1", 1).map(entryOf);
    await expect(putInOrder(flaky, entries, noWait)).rejects.toThrow("socket hang up");
    await putInOrder(flaky, entries, noWait);
    expect(stored(local)).toEqual(["n1@1", "n1@1"]);

    // Two records, two sequence numbers, one revision. The version tells them apart.
    const guarded = local.consumer();
    const blind = local.consumer({ mode: "blind" });
    await guarded.poller.drain();
    await blind.poller.drain();
    expect(await guarded.store.get("n1")).toMatchObject({ version: 1, revisions: 1 });
    expect(await blind.store.get("n1")).toMatchObject({ version: 1, revisions: 2 });
  });
});
