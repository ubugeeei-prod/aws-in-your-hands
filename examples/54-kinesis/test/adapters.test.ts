import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { PutRecordsCommand } from "@aws-sdk/client-kinesis";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import { DynamoDbHistoryStore } from "../src/dynamodb-history.ts";
import { parseConsumerEnv } from "../src/env.ts";
import { parseFailureRecord, readableUntil } from "../src/failure-record.ts";
import { KinesisWriter } from "../src/kinesis-writer.ts";
import { entryOf, revision } from "./fixtures.ts";

// These pin the requests the adapters send and the shapes they read. Whether
// DynamoDB, Kinesis, and Lambda answer as the chapter expects was not run against AWS.

function client<Command>(respond: () => unknown = () => ({})) {
  const sent: Command[] = [];
  return {
    sent,
    client: {
      send: async (command: Command) => {
        sent.push(command);
        return respond();
      },
    } as never,
  };
}

describe("DynamoDbHistoryStore requests", () => {
  it("moves a note forward and counts the revision in one conditional update", async () => {
    const { client: fake, sent } = client<UpdateCommand>();
    expect(await new DynamoDbHistoryStore(fake, "history").apply(revision("n1", 2))).toBe(
      "applied",
    );
    expect(sent[0]).toBeInstanceOf(UpdateCommand);
    expect(sent[0]?.input).toEqual({
      TableName: "history",
      Key: { noteId: "n1" },
      UpdateExpression:
        "SET #owner = :owner, #version = :version, #deleted = :deleted, #updatedAt = :at ADD #revisions :one",
      ConditionExpression: "attribute_not_exists(noteId) OR #version < :version",
      ExpressionAttributeNames: {
        "#owner": "owner",
        "#version": "version",
        "#deleted": "deleted",
        "#updatedAt": "updatedAt",
        "#revisions": "revisions",
      },
      ExpressionAttributeValues: {
        ":owner": "user-1",
        ":version": 2,
        ":deleted": false,
        ":at": "2026-10-13T00:00:02.000Z",
        ":one": 1,
      },
    });
  });

  it("takes a failed condition as an answer, and any other failure as a failure", async () => {
    const refused = client(() => {
      throw new ConditionalCheckFailedException({ message: "refused", $metadata: {} });
    });
    expect(await new DynamoDbHistoryStore(refused.client, "history").apply(revision("n1", 2))).toBe(
      "stale",
    );
    const down = client(() => {
      throw new Error("throttled");
    });
    await expect(
      new DynamoDbHistoryStore(down.client, "history").apply(revision("n1", 2)),
    ).rejects.toThrow("throttled");
  });

  it("sends no condition only where the page shows what that costs", async () => {
    const { client: fake, sent } = client<UpdateCommand>();
    await new DynamoDbHistoryStore(fake, "history").applyBlindly(revision("n1", 2));
    expect(sent[0]?.input).not.toHaveProperty("ConditionExpression");
  });

  it("reads a note's history with a consistent read, and refuses an item of another shape", async () => {
    const item = {
      noteId: "n1",
      owner: "user-1",
      version: 2,
      revisions: 2,
      deleted: false,
      updatedAt: "2026-10-13T00:00:02.000Z",
    };
    const stored = client<GetCommand>(() => ({ Item: item }));
    expect(await new DynamoDbHistoryStore(stored.client, "history").get("n1")).toEqual(item);
    expect(stored.sent[0]).toBeInstanceOf(GetCommand);
    expect(stored.sent[0]?.input).toEqual({
      TableName: "history",
      Key: { noteId: "n1" },
      ConsistentRead: true,
    });
    const empty = client(() => ({}));
    expect(await new DynamoDbHistoryStore(empty.client, "history").get("n1")).toBeUndefined();
    const broken = client(() => ({ Item: { ...item, version: "2" } }));
    await expect(new DynamoDbHistoryStore(broken.client, "history").get("n1")).rejects.toThrow();
  });
});

describe("KinesisWriter", () => {
  const ARN = "arn:aws:kinesis:ap-northeast-1:111122223333:stream/revisions";

  it("names the stream by ARN and files each record under its note", async () => {
    const { client: fake, sent } = client<PutRecordsCommand>(() => ({ Records: [] }));
    const entry = entryOf(revision("n1", 1));
    await new KinesisWriter(fake, ARN).putRecords([entry]);
    expect(sent[0]).toBeInstanceOf(PutRecordsCommand);
    expect(sent[0]?.input).toEqual({
      StreamARN: ARN,
      Records: [{ PartitionKey: "n1", Data: entry.data }],
    });
  });

  it("reads the answer entry by entry: a sequence number, or an error code", async () => {
    // The response of the developer guide's example, where the second of three records is refused.
    const { client: fake } = client(() => ({
      FailedRecordCount: 1,
      Records: [
        {
          SequenceNumber: "21269319989900637946712965403778482371",
          ShardId: "shardId-000000000001",
        },
        {
          ErrorCode: "ProvisionedThroughputExceededException",
          ErrorMessage: "Rate exceeded for shard shardId-000000000001 in stream exampleStreamName",
        },
        {
          SequenceNumber: "21269319989999637946712965403778482985",
          ShardId: "shardId-000000000002",
        },
      ],
    }));
    const entries = [revision("a", 1), revision("a", 2), revision("b", 1)].map(entryOf);
    expect(await new KinesisWriter(fake, ARN).putRecords(entries)).toEqual({
      records: [
        {
          shardId: "shardId-000000000001",
          sequenceNumber: "21269319989900637946712965403778482371",
        },
        { errorCode: "ProvisionedThroughputExceededException" },
        {
          shardId: "shardId-000000000002",
          sequenceNumber: "21269319989999637946712965403778482985",
        },
      ],
    });
  });
});

describe("the record Lambda leaves when it gives up on a batch", () => {
  // The example in the Lambda documentation for an SQS or SNS destination, as read on 2026-10-13.
  const documented = JSON.stringify({
    requestContext: {
      requestId: "c9b8fa9f-5a7f-xmpl-af9c-0c604cde93a5",
      functionArn: "arn:aws:lambda:us-east-2:123456789012:function:myfunction",
      condition: "RetryAttemptsExhausted",
      approximateInvokeCount: 1,
    },
    responseContext: { statusCode: 200, executedVersion: "$LATEST", functionError: "Unhandled" },
    version: "1.0",
    timestamp: "2019-11-14T00:38:06.021Z",
    KinesisBatchInfo: {
      shardId: "shardId-000000000001",
      startSequenceNumber: "49601189658422359378836298521827638475320189012309704722",
      endSequenceNumber: "49601189658422359378836298522902373528957594348623495186",
      approximateArrivalOfFirstRecord: "2019-11-14T00:38:04.835Z",
      approximateArrivalOfLastRecord: "2019-11-14T00:38:05.580Z",
      batchSize: 500,
      streamArn: "arn:aws:kinesis:us-east-2:123456789012:stream/mystream",
    },
  });

  it("says where the batch is, and holds none of its data", () => {
    const record = parseFailureRecord(documented);
    expect(record.KinesisBatchInfo).toMatchObject({
      shardId: "shardId-000000000001",
      startSequenceNumber: "49601189658422359378836298521827638475320189012309704722",
      batchSize: 500,
    });
    expect(documented).not.toContain('"data"');
  });

  it("can be acted on only while the stream still holds the batch", () => {
    expect(readableUntil(parseFailureRecord(documented), 24).toISOString()).toBe(
      "2019-11-15T00:38:04.835Z",
    );
  });

  it("is refused when it is some other message", () => {
    expect(() => parseFailureRecord(JSON.stringify({ Records: [] }))).toThrow();
  });
});

describe("the consumer's environment", () => {
  it("needs the table's name and defaults the log level", () => {
    expect(parseConsumerEnv({ HISTORY_TABLE: "history" })).toEqual({
      HISTORY_TABLE: "history",
      LOG_LEVEL: "info",
    });
    expect(() => parseConsumerEnv({})).toThrow("HISTORY_TABLE");
  });
});
