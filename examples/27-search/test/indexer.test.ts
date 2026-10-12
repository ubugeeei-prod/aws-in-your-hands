import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { describe, expect, it } from "vite-plus/test";

import type { LogEntry } from "@aih/example-04-http-api/src/log.ts";

import { MAX_PASSAGES_PER_NOTE } from "../src/chunk.ts";
import { createIndexer, type NoteChange, planChange } from "../src/indexer.ts";
import { InMemoryVectorIndex } from "../src/memory-vector-index.ts";
import { createStreamHandler, toChange } from "../src/stream.ts";
import { conceptEmbedder, CONCEPTS, keysIn } from "./helpers.ts";

const long = (version: number) => ({ title: "t", body: "x".repeat(2_000), version });
const short = (version: number) => ({ title: "t", body: "car", version });

const created: NoteChange = { owner: "alice", noteId: "n1", before: "none", after: long(1) };
const shortened: NoteChange = { owner: "alice", noteId: "n1", before: long(1), after: short(2) };
const deleted: NoteChange = { owner: "alice", noteId: "n1", before: short(2), after: undefined };

describe("planChange", () => {
  it("embeds every passage of the new version", () => {
    const plan = planChange(created);
    expect(plan.embed.map((passage) => passage.key)).toEqual([
      "alice/n1/0",
      "alice/n1/1",
      "alice/n1/2",
    ]);
    expect(plan.remove).toEqual([]);
  });

  it("removes the passages a shorter version no longer has", () => {
    expect(planChange(shortened)).toMatchObject({
      embed: [{ key: "alice/n1/0" }],
      remove: ["alice/n1/1", "alice/n1/2"],
      version: 2,
    });
  });

  it("removes everything for a delete, and embeds nothing", () => {
    expect(planChange(deleted)).toEqual({ embed: [], remove: ["alice/n1/0"], version: undefined });
  });

  it("clears every key a note could have had when nobody knows how long it was", () => {
    expect(planChange({ ...deleted, before: "unknown" }).remove).toHaveLength(
      MAX_PASSAGES_PER_NOTE,
    );
    // Passage 0 is written, the other fourteen possible keys are cleared.
    expect(planChange({ ...shortened, before: "unknown" }).remove).toHaveLength(
      MAX_PASSAGES_PER_NOTE - 1,
    );
  });
});

function setup() {
  const embedder = conceptEmbedder(CONCEPTS);
  const index = new InMemoryVectorIndex(3);
  return { embedder, index, indexer: createIndexer({ embedder, index }) };
}

describe("the indexer", () => {
  it("leaves the same index when a change is delivered twice", async () => {
    const { index, indexer } = setup();
    await indexer(created);
    const once = await keysIn(index);
    await indexer(created);
    expect(await keysIn(index)).toEqual(once);
    expect(once).toEqual(["alice/n1/0@1", "alice/n1/1@1", "alice/n1/2@1"]);
  });

  it("leaves no passage of the old version after an edit, delivered once or twice", async () => {
    const { index, indexer } = setup();
    await indexer(created);
    await indexer(shortened);
    await indexer(shortened);
    expect(await keysIn(index)).toEqual(["alice/n1/0@2"]);
  });

  it("leaves nothing after a delete, even when the delete is delivered again", async () => {
    const { index, indexer } = setup();
    await indexer(created);
    await indexer(shortened);
    await indexer(deleted);
    await indexer(deleted);
    expect(index.size).toBe(0);
  });

  it("writes nothing when an embedding fails partway through a note", async () => {
    const { index, embedder, indexer } = setup();
    embedder.embed = async () => {
      embedder.calls += 1;
      if (embedder.calls === 2) {
        throw new Error("ThrottlingException");
      }
      return [1, 0, 0];
    };
    await expect(indexer(created)).rejects.toThrow("ThrottlingException");
    // All passages of a version go in together, or none do.
    expect(index.size).toBe(0);
  });
});

// The shape of a record as the Lambda documentation and @types/aws-lambda give it.
function record(
  sequenceNumber: string,
  eventName: "INSERT" | "MODIFY" | "REMOVE",
  sk: string,
  images: { old?: { body: string; version: number }; new?: { body: string; version: number } },
): DynamoDBRecord {
  const image = (value: { body: string; version: number }) => ({
    pk: { S: "OWNER#alice" },
    sk: { S: sk },
    id: { S: sk.slice(5) },
    title: { S: "t" },
    body: { S: value.body },
    version: { N: String(value.version) },
  });
  return {
    eventName,
    dynamodb: {
      SequenceNumber: sequenceNumber,
      Keys: { pk: { S: "OWNER#alice" }, sk: { S: sk } },
      ...(images.new === undefined ? {} : { NewImage: image(images.new) }),
      ...(images.old === undefined ? {} : { OldImage: image(images.old) }),
    },
  };
}

describe("toChange", () => {
  it("reads the owner, the note and both images out of a record", () => {
    const change = toChange(
      record("100", "MODIFY", "NOTE#n1", {
        old: { body: "a", version: 1 },
        new: { body: "b", version: 2 },
      }),
    );
    expect(change).toEqual({
      owner: "alice",
      noteId: "n1",
      before: { title: "t", body: "a", version: 1 },
      after: { title: "t", body: "b", version: 2 },
    });
    expect(
      toChange(record("101", "INSERT", "NOTE#n2", { new: { body: "a", version: 1 } })),
    ).toMatchObject({
      before: "none",
    });
    expect(toChange(record("102", "REMOVE", "NOTE#n2", {}))).toMatchObject({
      before: "unknown",
      after: undefined,
    });
  });

  it("skips items that are not notes, such as chapter 05's counter", () => {
    expect(
      toChange({
        eventName: "MODIFY",
        dynamodb: { Keys: { pk: { S: "OWNER#alice" }, sk: { S: "QUOTA" } } },
      }),
    ).toBeUndefined();
  });

  it("refuses a note it cannot read instead of indexing a guess", () => {
    const broken = record("100", "INSERT", "NOTE#n1", { new: { body: "a", version: 0 } });
    expect(() => toChange(broken)).toThrow();
    expect(() => toChange(record("100", "INSERT", "NOTE#n1", {}))).toThrow(/new image/);
  });
});

describe("the stream handler", () => {
  const batch: DynamoDBStreamEvent = {
    Records: [
      record("100", "INSERT", "NOTE#n1", { new: { body: "car", version: 1 } }),
      record("101", "INSERT", "NOTE#n2", { new: { body: "payment", version: 1 } }),
      record("102", "MODIFY", "NOTE#n1", {
        old: { body: "car", version: 1 },
        new: { body: "automobile", version: 2 },
      }),
    ],
  };

  function handlerWith(failOn: (noteId: string, version: number | undefined) => boolean) {
    const { index, indexer } = setup();
    const logs: LogEntry[] = [];
    const applied: string[] = [];
    const handler = createStreamHandler({
      indexer: async (change) => {
        if (failOn(change.noteId, change.after?.version)) {
          throw new Error("ServiceUnavailableException");
        }
        applied.push(`${change.noteId}@${change.after?.version}`);
        await indexer(change);
      },
      log: (entry) => logs.push(entry),
    });
    return { handler, index, applied, logs };
  }

  it("reports nothing when every record was applied", async () => {
    const { handler, index } = handlerWith(() => false);
    expect(await handler(batch)).toEqual({ batchItemFailures: [] });
    expect(await keysIn(index)).toEqual(["alice/n1/0@2", "alice/n2/0@1"]);
  });

  it("stops at the first failure and tells Lambda where to resume", async () => {
    let failing = true;
    const { handler, index, applied } = handlerWith((noteId) => failing && noteId === "n2");
    expect(await handler(batch)).toEqual({ batchItemFailures: [{ itemIdentifier: "101" }] });
    // The later change to n1 was not applied ahead of the record that failed.
    expect(applied).toEqual(["n1@1"]);

    // Lambda sends the batch again from record 101. Record 100 may come again too.
    failing = false;
    expect(await handler(batch)).toEqual({ batchItemFailures: [] });
    expect(await keysIn(index)).toEqual(["alice/n1/0@2", "alice/n2/0@1"]);
  });

  it("fails a record it cannot read, so it ends in the dead-letter queue and not in silence", async () => {
    const { handler, logs } = handlerWith(() => false);
    const poisoned = { Records: [record("200", "INSERT", "NOTE#n9", {})] };
    expect(await handler(poisoned)).toEqual({ batchItemFailures: [{ itemIdentifier: "200" }] });
    expect(logs.at(-1)).toMatchObject({ level: "error", sequenceNumber: "200" });
  });
});
