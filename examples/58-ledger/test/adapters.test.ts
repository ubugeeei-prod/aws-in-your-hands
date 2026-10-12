import { DuplicateItemException, DynamoDBServiceException } from "@aws-sdk/client-dynamodb";
import { S3ServiceException } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vite-plus/test";

import { dynamoDbJournal, insertStatement } from "../src/dynamodb-journal.ts";
import { GENESIS, seal } from "../src/entry.ts";
import { S3Digests, putDigestInput } from "../src/s3-digests.ts";

const entry = seal({
  ledger: "notes",
  seq: 7,
  at: "2026-10-13T00:07:00.000Z",
  event: "e",
  prev: GENESIS,
});

type Sent = { constructor: { name: string }; input: Record<string, unknown> };
const fake = (answer: (command: Sent) => unknown) => {
  const sent: Sent[] = [];
  return {
    sent,
    client: {
      send: async (command: Sent) => {
        sent.push(command);
        return answer(command);
      },
    } as never,
  };
};

describe("the DynamoDB journal", () => {
  it("inserts with PartiQL, with every value as a parameter", () => {
    expect(insertStatement("aih-ledger", entry)).toEqual({
      Statement: `INSERT INTO "aih-ledger" VALUE {'pk': ?, 'sk': ?, 'seq': ?, 'at': ?, 'event': ?, 'prev': ?, 'hash': ?}`,
      Parameters: [
        "LEDGER#notes",
        "ENTRY#000000000007",
        7,
        "2026-10-13T00:07:00.000Z",
        "e",
        GENESIS,
        entry.hash,
      ],
    });
  });

  it("refuses a table name that could end the identifier", () => {
    expect(() => insertStatement('x" VALUE {} --', entry)).toThrow();
  });

  it("never sends PutItem, UpdateItem, or DeleteItem", async () => {
    const { client, sent } = fake(() => ({ Items: [] }));
    const journal = dynamoDbJournal(client, "aih-ledger");
    await journal.insert(entry);
    await journal.tail("notes");
    await journal.read("notes", 0, 10);
    expect(sent.map((command) => command.constructor.name)).toEqual([
      "ExecuteStatementCommand",
      "QueryCommand",
      "QueryCommand",
    ]);
  });

  it("reads the tail newest first, one item, with strong consistency", async () => {
    const { client, sent } = fake(() => ({ Items: [] }));
    await dynamoDbJournal(client, "aih-ledger").tail("notes");
    expect(sent[0]?.input).toMatchObject({
      TableName: "aih-ledger",
      ScanIndexForward: false,
      Limit: 1,
      ConsistentRead: true,
    });
  });

  it("answers `exists` to DuplicateItemException, and passes other errors on", async () => {
    const duplicate = fake(() => {
      throw new DuplicateItemException({ message: "Duplicate primary key", $metadata: {} });
    });
    expect(await dynamoDbJournal(duplicate.client, "aih-ledger").insert(entry)).toBe("exists");

    // The name DynamoDB Local 3.3.1 uses for the same refusal.
    const local = fake(() => {
      throw new DynamoDBServiceException({
        name: "DuplicateItem",
        $fault: "client",
        $metadata: {},
      });
    });
    expect(await dynamoDbJournal(local.client, "aih-ledger").insert(entry)).toBe("exists");

    const denied = fake(() => {
      throw new Error("AccessDeniedException");
    });
    await expect(dynamoDbJournal(denied.client, "aih-ledger").insert(entry)).rejects.toThrow(
      "AccessDeniedException",
    );
  });
});

describe("the S3 digest store", () => {
  it("writes only when the key is free, and names no retention of its own", () => {
    const input = putDigestInput("bucket", "digests/notes/000000000004.json", "{}");
    expect(input).toMatchObject({ IfNoneMatch: "*", Bucket: "bucket" });
    expect(Object.keys(input).filter((name) => name.startsWith("ObjectLock"))).toEqual([]);
  });

  it("answers `exists` to 412, and passes other errors on", async () => {
    const failing = (status: number) =>
      fake(() => {
        throw new S3ServiceException({
          name: "Failure",
          $fault: "client",
          $metadata: { httpStatusCode: status },
        });
      });
    expect(await new S3Digests(failing(412).client, "bucket").put("k", "{}")).toBe("exists");
    await expect(new S3Digests(failing(403).client, "bucket").put("k", "{}")).rejects.toThrow();
  });

  it("lists every version and every delete marker, across pages", async () => {
    const pages = [
      {
        Versions: [{ Key: "digests/notes/1.json", VersionId: "b" }],
        DeleteMarkers: [{ Key: "digests/notes/1.json", VersionId: "c" }],
        IsTruncated: true,
        NextKeyMarker: "digests/notes/1.json",
        NextVersionIdMarker: "b",
      },
      { Versions: [{ Key: "digests/notes/1.json", VersionId: "a" }], IsTruncated: false },
    ];
    const { client, sent } = fake(() => pages.shift());

    const versions = await new S3Digests(client, "bucket").list("digests/notes/");

    expect(versions).toEqual([
      { key: "digests/notes/1.json", versionId: "b", deleteMarker: false },
      { key: "digests/notes/1.json", versionId: "c", deleteMarker: true },
      { key: "digests/notes/1.json", versionId: "a", deleteMarker: false },
    ]);
    expect(sent.map((command) => command.constructor.name)).toEqual([
      "ListObjectVersionsCommand",
      "ListObjectVersionsCommand",
    ]);
    expect(sent[1]?.input).toMatchObject({
      Prefix: "digests/notes/",
      KeyMarker: "digests/notes/1.json",
      VersionIdMarker: "b",
    });
  });

  it("reads one version by its ID", async () => {
    const { client, sent } = fake(() => ({ Body: { transformToString: async () => "{}" } }));
    expect(await new S3Digests(client, "bucket").get("k", "v9")).toBe("{}");
    expect(sent[0]?.input).toEqual({ Bucket: "bucket", Key: "k", VersionId: "v9" });
  });
});
