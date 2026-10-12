import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { GetObjectCommand } from "@aws-sdk/client-s3";
import { NoSuchKey, S3ServiceException } from "@aws-sdk/client-s3";
import type { GetCommand } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import { DynamoDbInspectionRepository } from "../src/dynamodb-inspection-repository.ts";
import { parseFunctionEnv, parseLocalQueueEnv } from "../src/env.ts";
import type { Inspection } from "../src/inspection.ts";
import { S3ObjectReader } from "../src/s3-object-reader.ts";

// These pin the requests the adapters send. Whether DynamoDB and S3 answer
// them as the chapter expects has not been run against either service.

const inspection: Inspection = {
  noteId: "n1",
  attachmentId: "a1",
  sequencer: "000000000000000055AED6DCD90281E5",
  eTag: "d41d8cd98f00b204e9800998ecf8427e",
  size: 170,
  declaredType: "image/png",
  verdict: "ok",
  width: 3,
  height: 2,
  inspectedAt: "2026-10-12T00:00:00.000Z",
};
const conflict = new ConditionalCheckFailedException({
  message: "The conditional request failed",
  $metadata: {},
});

function table(respond: () => unknown = () => ({})) {
  const sent: (PutCommand | DeleteCommand | GetCommand)[] = [];
  const client = {
    send: async (command: PutCommand | DeleteCommand | GetCommand) => {
      sent.push(command);
      return respond();
    },
  };
  return { repository: new DynamoDbInspectionRepository(client as never, "notes-table"), sent };
}

describe("DynamoDbInspectionRepository requests", () => {
  it("writes on the condition that nothing from this event or a later one is stored", async () => {
    const { repository, sent } = table();
    expect(await repository.putIfNewer("u1", { ...inspection, reason: undefined })).toBe("written");
    expect(sent[0]).toBeInstanceOf(PutCommand);
    expect(sent[0]?.input).toEqual({
      TableName: "notes-table",
      Item: { pk: "OWNER#u1", sk: "INSPECTION#n1#a1", ...inspection },
      ConditionExpression: "attribute_not_exists(pk) OR sequencer < :sequencer",
      ExpressionAttributeValues: { ":sequencer": inspection.sequencer },
    });
  });

  it("takes a failed condition as an answer, and any other failure as a failure", async () => {
    const refused = table(() => {
      throw conflict;
    });
    expect(await refused.repository.putIfNewer("u1", inspection)).toBe("not_newer");
    expect(await refused.repository.deleteIfOlder("u1", "n1", "a1", inspection.sequencer)).toBe(
      "kept",
    );

    const broken = table(() => {
      throw new Error("ProvisionedThroughputExceededException");
    });
    await expect(broken.repository.putIfNewer("u1", inspection)).rejects.toThrow("Throughput");
  });

  it("deletes under the same condition", async () => {
    const { repository, sent } = table();
    expect(await repository.deleteIfOlder("u1", "n1", "a1", inspection.sequencer)).toBe("deleted");
    expect(sent[0]).toBeInstanceOf(DeleteCommand);
    expect(sent[0]?.input).toMatchObject({
      Key: { pk: "OWNER#u1", sk: "INSPECTION#n1#a1" },
      ConditionExpression: "attribute_not_exists(pk) OR sequencer < :sequencer",
    });
  });

  it("validates what it reads back", async () => {
    const good = table(() => ({ Item: { pk: "OWNER#u1", sk: "INSPECTION#n1#a1", ...inspection } }));
    expect(await good.repository.get("u1", "n1", "a1")).toEqual(inspection);
    expect(good.sent[0]?.input).toMatchObject({ ConsistentRead: true });

    const bad = table(() => ({
      Item: { pk: "OWNER#u1", sk: "INSPECTION#n1#a1", ...inspection, sequencer: "E5" },
    }));
    await expect(bad.repository.get("u1", "n1", "a1")).rejects.toThrow();
    expect(await table().repository.get("u1", "n1", "a1")).toBeUndefined();
  });
});

function bucket(respond: () => unknown) {
  const sent: GetObjectCommand[] = [];
  const client = {
    send: async (command: GetObjectCommand) => {
      sent.push(command);
      return respond();
    },
  };
  return { reader: new S3ObjectReader(client as never, "uploads"), sent };
}
const s3Error = (status: number) =>
  new S3ServiceException({
    name: "Error",
    $fault: "client",
    $metadata: { httpStatusCode: status },
  });

describe("S3ObjectReader requests", () => {
  it("asks for the object the event describes, and no more than a limit", async () => {
    const { reader, sent } = bucket(() => ({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
      ContentType: "image/png",
      ContentRange: "bytes 0-2/170",
    }));
    expect(await reader.readExact("u/a/n/x", "abc", 5)).toEqual({
      status: "found",
      bytes: new Uint8Array([1, 2, 3]),
      size: 170,
      contentType: "image/png",
    });
    expect(sent[0]?.input).toEqual({
      Bucket: "uploads",
      Key: "u/a/n/x",
      IfMatch: '"abc"',
      Range: "bytes=0-4",
    });
  });

  it("tells gone from replaced from broken", async () => {
    const answer = (error: unknown) =>
      bucket(() => {
        throw error;
      }).reader.readExact("u/a/n/x", "abc", 5);
    expect(await answer(new NoSuchKey({ message: "gone", $metadata: {} }))).toEqual({
      status: "gone",
    });
    expect(await answer(s3Error(412))).toEqual({ status: "changed" });
    expect(await answer(s3Error(416))).toMatchObject({ status: "found", size: 0 });
    // Without s3:ListBucket a missing key is a 403, and that must not pass as "gone".
    await expect(answer(s3Error(403))).rejects.toThrow();
  });
});

describe("environment", () => {
  it("names what a function is missing", () => {
    expect(() => parseFunctionEnv({ TABLE_NAME: "notes" })).toThrow("UPLOADS_BUCKET");
    expect(parseFunctionEnv({ TABLE_NAME: "notes", UPLOADS_BUCKET: "uploads" })).toMatchObject({
      LOG_LEVEL: "info",
    });
  });

  it("gives the local queue defaults, and refuses nonsense", () => {
    expect(parseLocalQueueEnv({})).toEqual({
      LOCAL_QUEUE_VISIBILITY_SECONDS: 5,
      LOCAL_QUEUE_MAX_RECEIVE_COUNT: 3,
      LOCAL_QUEUE_DUPLICATE: "false",
    });
    expect(() => parseLocalQueueEnv({ LOCAL_QUEUE_MAX_RECEIVE_COUNT: "0" })).toThrow(
      "LOCAL_QUEUE_MAX_RECEIVE_COUNT",
    );
  });
});
