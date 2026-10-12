import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { describeRepositoryContract } from "@aih/example-05-dynamodb/test/repository-contract.ts";
import { DynamoDbAttachmentRepository } from "@aih/example-07-uploads/api/src/dynamodb-attachment-repository.ts";
import { DynamoDbInspectionRepository } from "@aih/example-08-async/src/dynamodb-inspection-repository.ts";

import { audit } from "../src/audit.ts";
import { DynamoDbTable } from "../src/dynamodb-table.ts";
import { check, takeSnapshot } from "../src/invariants.ts";
import { classify, type TableItem } from "../src/items.ts";
import { MemoryTable, TableNoteRepository } from "../src/memory-table.ts";
import { nextSequencer } from "../src/repair.ts";
import { S3VersionedBucket } from "../src/s3-versioned-bucket.ts";
import { createWorld, OWNER } from "./world.ts";

type Sent = { constructor: { name: string }; input: Record<string, unknown> };

/** Answers each command from a queue and keeps what was sent. */
function fakeClient(responses: unknown[] = []) {
  const sent: Sent[] = [];
  return {
    sent,
    client: {
      send: async (command: Sent) => {
        sent.push(command);
        const next = responses.shift();
        if (next instanceof Error) {
          throw next;
        }
        return next ?? {};
      },
    } as never,
  };
}

const note = {
  id: "0001-abcd",
  title: "trip",
  body: "",
  version: 1,
  createdAt: "2026-10-12T09:00:00.000Z",
  updatedAt: "2026-10-12T09:00:00.000Z",
};
const attachment = {
  id: "0002-efgh",
  noteId: note.id,
  contentType: "image/png" as const,
  size: 33,
  createdAt: "2026-10-12T09:01:00.000Z",
};
const inspection = {
  noteId: note.id,
  attachmentId: attachment.id,
  sequencer: `${"0".repeat(31)}1`,
  eTag: "abc",
  size: 33,
  declaredType: "image/png",
  verdict: "ok" as const,
  width: 3,
  height: 2,
  inspectedAt: "2026-10-12T09:01:05.000Z",
};

describe("classify", () => {
  it("reads the items that the repositories of chapters 05, 07, and 08 write", async () => {
    const { sent, client } = fakeClient();
    await new DynamoDbNoteRepository(client, "t").create(OWNER, note);
    await new DynamoDbAttachmentRepository(client, "t").create(OWNER, attachment);
    await new DynamoDbInspectionRepository(client, "t").putIfNewer(OWNER, inspection);

    expect(sent.map((command) => classify(command.input["Item"]))).toEqual([
      { kind: "note", owner: OWNER, note },
      { kind: "attachment", owner: OWNER, attachment },
      { kind: "inspection", owner: OWNER, inspection },
    ]);
  });

  it.each([
    ["no keys", { title: "x" }],
    ["another app's partition", { pk: "TENANT#1", sk: "NOTE#1" }],
    ["a note of an older shape", { pk: "OWNER#alice", sk: "NOTE#1", id: "1", title: "no version" }],
    ["a key that disagrees with its body", { pk: "OWNER#alice", sk: "NOTE#other", ...note }],
    ["an unknown kind", { pk: "OWNER#alice", sk: "DRAFT#1" }],
  ])("does not pass %s off as data", (_name, item) => {
    expect(classify(item)).toMatchObject({ kind: "unknown" });
  });

  it("turns an unreadable item into a finding, not an exception", async () => {
    const world = createWorld();
    world.table.put({ pk: "OWNER#alice", sk: "NOTE#1", id: "1", title: "no version" });
    expect((await world.report()).findings).toEqual([
      {
        kind: "unreadable_item",
        pk: "OWNER#alice",
        sk: "NOTE#1",
        reason: "not a note this app wrote",
      },
    ]);
  });

  it("flags a note whose version and timestamps contradict each other", () => {
    const edited = { ...note, updatedAt: "2026-10-12T10:00:00.000Z" };
    const snapshot = {
      notes: [{ owner: OWNER, note: edited }],
      attachments: [],
      inspections: [],
      unreadable: [],
      objects: [],
    };
    expect(check(snapshot, { now: new Date() }).findings).toEqual([
      { kind: "note_version_mismatch", owner: OWNER, noteId: note.id },
    ]);
  });
});

describeRepositoryContract("on the memory table", async () => ({
  repository: new TableNoteRepository(new MemoryTable(() => new Date())),
  owner: "test",
}));

describe("MemoryTable.restoreTo", () => {
  it("builds a new table as of the point and leaves the source as it is", async () => {
    const world = createWorld();
    const kept = await world.createNote("kept");
    const point = world.tick();
    await world.deleteNote(kept.id);
    const later = await world.createNote("later");

    const restored = world.open(world.table.restoreTo(point), world.bucket);
    expect(await restored.notes.get(OWNER, kept.id)).toBeDefined();
    expect(await restored.notes.get(OWNER, later.id)).toBeUndefined();
    expect(await world.notes.get(OWNER, kept.id)).toBeUndefined();
    expect(await world.notes.get(OWNER, later.id)).toBeDefined();
  });
});

describe("DynamoDbTable", () => {
  it("scans every page with consistent reads", async () => {
    const { sent, client } = fakeClient([
      { Items: [{ pk: "a", sk: "1" }], LastEvaluatedKey: { pk: "a", sk: "1" } },
      { Items: [{ pk: "b", sk: "2" }] },
    ]);
    const items: TableItem[] = [];
    for await (const item of new DynamoDbTable(client, "Notes").scan()) {
      items.push(item);
    }
    expect(items).toHaveLength(2);
    expect(sent.map((command) => command.input)).toEqual([
      { TableName: "Notes", ConsistentRead: true, ExclusiveStartKey: undefined },
      { TableName: "Notes", ConsistentRead: true, ExclusiveStartKey: { pk: "a", sk: "1" } },
    ]);
  });

  it("raises a version only upwards, and only on a note that exists", async () => {
    const refused = new ConditionalCheckFailedException({ message: "no", $metadata: {} });
    const { sent, client } = fakeClient([{}, refused]);
    const table = new DynamoDbTable(client, "Notes");

    expect(await table.raiseVersion(OWNER, "n1", 4)).toBe("raised");
    expect(await table.raiseVersion(OWNER, "n1", 4)).toBe("unchanged");
    expect(sent[0]?.input).toEqual({
      TableName: "Notes",
      Key: { pk: "OWNER#alice", sk: "NOTE#n1" },
      UpdateExpression: "SET version = :to",
      ConditionExpression: "attribute_exists(pk) AND version < :to",
      ExpressionAttributeValues: { ":to": 4 },
    });
  });
});

describe("S3VersionedBucket", () => {
  const at = new Date("2026-10-12T09:00:00Z");

  it("merges versions and delete markers across pages, with bare ETags", async () => {
    const { sent, client } = fakeClient([
      {
        Versions: [
          {
            Key: "u/a/n/1",
            VersionId: "v1",
            IsLatest: false,
            LastModified: at,
            ETag: '"abc"',
            Size: 3,
          },
        ],
        DeleteMarkers: [{ Key: "u/a/n/1", VersionId: "m1", IsLatest: true, LastModified: at }],
        IsTruncated: true,
        NextKeyMarker: "u/a/n/1",
        NextVersionIdMarker: "v1",
      },
      {
        Versions: [
          { Key: "u/a/n/2", VersionId: "v2", IsLatest: true, LastModified: at, ETag: '"def"' },
        ],
      },
    ]);
    const versions = [];
    for await (const version of new S3VersionedBucket(client, "bucket").listVersions("u/")) {
      versions.push(version);
    }
    expect(versions).toEqual([
      {
        key: "u/a/n/1",
        versionId: "v1",
        deleteMarker: false,
        isLatest: false,
        lastModified: at,
        eTag: "abc",
      },
      { key: "u/a/n/1", versionId: "m1", deleteMarker: true, isLatest: true, lastModified: at },
      {
        key: "u/a/n/2",
        versionId: "v2",
        deleteMarker: false,
        isLatest: true,
        lastModified: at,
        eTag: "def",
      },
    ]);
    expect(sent[1]?.input).toMatchObject({ KeyMarker: "u/a/n/1", VersionIdMarker: "v1" });
  });

  it("always names the version when it deletes or copies", async () => {
    const { sent, client } = fakeClient();
    const bucket = new S3VersionedBucket(client, "bucket");
    await bucket.removeVersion("u/a/n/1", "m1");
    await bucket.copyVersion("u/a/n/1", "v 1");

    expect(sent.map((command) => [command.constructor.name, command.input])).toEqual([
      ["DeleteObjectCommand", { Bucket: "bucket", Key: "u/a/n/1", VersionId: "m1" }],
      [
        "CopyObjectCommand",
        { Bucket: "bucket", Key: "u/a/n/1", CopySource: "bucket/u/a/n/1?versionId=v%201" },
      ],
    ]);
  });

  it("lists current objects with the ETag form that chapter 08's records use", async () => {
    const { client } = fakeClient([
      {
        Contents: [{ Key: "u/a/n/1", ETag: '"abc"', Size: 3, LastModified: at }],
        IsTruncated: false,
      },
    ]);
    const objects = [];
    for await (const object of new S3VersionedBucket(client, "bucket").listCurrent("u/")) {
      objects.push(object);
    }
    expect(objects).toEqual([{ key: "u/a/n/1", eTag: "abc", size: 3, lastModified: at }]);
  });
});

describe("audit", () => {
  it("counts what it read and what does not line up", async () => {
    const world = createWorld();
    const trip = await world.createNote("trip");
    const image = await world.attach(trip.id);
    await world.bucket.delete(image.key);

    const result = await audit({
      tableName: "Notes",
      table: world.table,
      bucket: world.bucket,
      now: world.now,
    });
    expect(result).toMatchObject({
      tableName: "Notes",
      notes: 1,
      attachments: 1,
      inspections: 1,
      objects: 0,
      broken: 1,
      leftover: 1,
      byKind: { attachment_without_object: 1, inspection_without_object: 1 },
    });
    expect((await takeSnapshot(world.table, world.bucket)).attachments).toHaveLength(1);
  });
});

describe("nextSequencer", () => {
  it("is the next value in the fixed-width form that chapter 08 compares as strings", () => {
    expect(nextSequencer(`${"0".repeat(30)}0F`)).toBe(`${"0".repeat(30)}10`);
    expect(nextSequencer(`${"0".repeat(30)}FF`)).toBe(`${"0".repeat(29)}100`);
    expect(nextSequencer(`${"0".repeat(31)}9`) > `${"0".repeat(31)}9`).toBe(true);
  });
});
