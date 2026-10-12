import { NotFound, S3ServiceException } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vite-plus/test";

import { DynamoDbNoteSource } from "../src/dynamodb-note-source.ts";
import { S3ExportStore } from "../src/s3-export-store.ts";
import { note } from "./harness.ts";

type Sent = { name: string; input: Record<string, unknown> };

/** Records what would go to AWS and answers from a script. Nothing leaves the process. */
function fakeClient(answers: (unknown | Error)[]) {
  const sent: Sent[] = [];
  return {
    sent,
    client: {
      send: async (command: { constructor: { name: string }; input: object }) => {
        sent.push({ name: command.constructor.name, input: { ...command.input } });
        const answer = answers.shift();
        if (answer instanceof Error) {
          throw answer;
        }
        return answer ?? {};
      },
    } as never,
  };
}

const s3Error = (status: number, name: string) =>
  new S3ServiceException({
    name,
    $fault: "client",
    $metadata: { httpStatusCode: status },
    message: name,
  });

describe("S3ExportStore", () => {
  it("asks S3 to write only if the key is free", async () => {
    const { client, sent } = fakeClient([{}]);
    const result = await new S3ExportStore(client, "bucket").putIfAbsent(
      "exports/x/parts/00001.ndjson",
      "{}\n",
      {
        count: "1",
      },
    );
    expect(result).toBe("written");
    expect(sent).toEqual([
      {
        name: "PutObjectCommand",
        input: {
          Bucket: "bucket",
          Key: "exports/x/parts/00001.ndjson",
          Body: "{}\n",
          ContentType: "application/x-ndjson",
          Metadata: { count: "1" },
          IfNoneMatch: "*",
        },
      },
    ]);
  });

  it("reports a taken key as a result, and a conflict as a failure to retry", async () => {
    const taken = fakeClient([s3Error(412, "PreconditionFailed")]);
    expect(await new S3ExportStore(taken.client, "bucket").putIfAbsent("k", "", {})).toBe("exists");

    const conflict = fakeClient([s3Error(409, "ConditionalRequestConflict")]);
    await expect(
      new S3ExportStore(conflict.client, "bucket").putIfAbsent("k", "", {}),
    ).rejects.toThrow("ConditionalRequestConflict");
  });

  it("reads the metadata back, and tells a missing object from a failure", async () => {
    const found = fakeClient([{ Metadata: { count: "10", next: "abc" } }]);
    expect(await new S3ExportStore(found.client, "bucket").head("k")).toEqual({
      count: "10",
      next: "abc",
    });

    const missing = fakeClient([
      new NotFound({ $metadata: { httpStatusCode: 404 }, message: "Not Found" }),
    ]);
    expect(await new S3ExportStore(missing.client, "bucket").head("k")).toBeUndefined();

    const denied = fakeClient([s3Error(403, "Forbidden")]);
    await expect(new S3ExportStore(denied.client, "bucket").head("k")).rejects.toThrow("Forbidden");
  });

  it("follows the continuation token to the end of a listing", async () => {
    const { client, sent } = fakeClient([
      { Contents: [{ Key: "p/1" }], IsTruncated: true, NextContinuationToken: "t" },
      { Contents: [{ Key: "p/2" }], IsTruncated: false },
    ]);
    expect(await new S3ExportStore(client, "bucket").list("p/")).toEqual(["p/1", "p/2"]);
    expect(sent.map((call) => call.input["ContinuationToken"])).toEqual([undefined, "t"]);
  });
});

describe("DynamoDbNoteSource", () => {
  const { owner, ...stored } = note("alice", 1);
  const item = { pk: `OWNER#${owner}`, sk: `NOTE#${stored.id}`, ...stored };

  it("scans a page of notes and turns the last key into a cursor", async () => {
    const { client, sent } = fakeClient([
      { Items: [item], LastEvaluatedKey: { pk: item.pk, sk: item.sk } },
      { Items: [] },
    ]);
    const source = new DynamoDbNoteSource(client, "table");

    const first = await source.page(null, 50);
    expect(first.notes).toEqual([note("alice", 1)]);
    expect(sent[0]).toEqual({
      name: "ScanCommand",
      input: {
        TableName: "table",
        Limit: 50,
        FilterExpression: "begins_with(sk, :note)",
        ExpressionAttributeValues: { ":note": "NOTE#" },
      },
    });

    const second = await source.page(first.nextCursor, 50);
    expect(sent[1]?.input["ExclusiveStartKey"]).toEqual({ pk: item.pk, sk: item.sk });
    expect(second).toEqual({ notes: [], nextCursor: null });
  });

  it("rejects a cursor it did not issue, and an item that is not a note", async () => {
    const source = new DynamoDbNoteSource(
      fakeClient([{ Items: [{ ...item, version: 0 }] }]).client,
      "table",
    );
    await expect(source.page(Buffer.from('{"pk":1}').toString("base64url"), 50)).rejects.toThrow();
    await expect(source.page(null, 50)).rejects.toThrow();
  });
});
