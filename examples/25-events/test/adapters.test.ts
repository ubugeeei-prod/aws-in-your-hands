import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import type { GetCommand } from "@aws-sdk/lib-dynamodb";
import { PutCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import { DynamoDbCounterStore, DynamoDbTimelineStore } from "../src/dynamodb-projections.ts";
import { parseConsumerEnv, parseShapeEnv } from "../src/env.ts";
import type { TimelineEntry } from "../src/timeline.ts";

// These pin the requests the adapters send. Whether DynamoDB answers them as
// the chapter expects has not been run against the service.

type Sent = PutCommand | GetCommand | TransactWriteCommand | UpdateCommand;
function client(respond: () => unknown = () => ({})) {
  const sent: Sent[] = [];
  return {
    sent,
    client: {
      send: async (command: Sent) => {
        sent.push(command);
        return respond();
      },
    } as never,
  };
}
const now = () => new Date("2026-10-12T00:00:00.000Z");
const entry: TimelineEntry = {
  noteId: "n1",
  lastEvent: "NoteUpdated",
  rank: 2,
  occurredAt: "2026-10-12T00:02:00.000Z",
  eventId: "note:u1/n1#2",
};

describe("DynamoDbTimelineStore requests", () => {
  it("writes on the condition that nothing of this rank or a higher one is stored", async () => {
    const { client: fake, sent } = client();
    expect(await new DynamoDbTimelineStore(fake, "projections").putIfNewer("u1", entry)).toBe(
      "written",
    );
    expect(sent[0]).toBeInstanceOf(PutCommand);
    expect(sent[0]?.input).toEqual({
      TableName: "projections",
      Item: { pk: "OWNER#u1", sk: "TIMELINE#n1", ...entry },
      ConditionExpression: "attribute_not_exists(pk) OR #rank < :rank",
      ExpressionAttributeNames: { "#rank": "rank" },
      ExpressionAttributeValues: { ":rank": 2 },
    });
  });

  it("takes a failed condition as an answer, and any other failure as a failure", async () => {
    const refused = client(() => {
      throw new ConditionalCheckFailedException({ message: "refused", $metadata: {} });
    });
    expect(
      await new DynamoDbTimelineStore(refused.client, "projections").putIfNewer("u1", entry),
    ).toBe("not_newer");
    const down = client(() => {
      throw new Error("throttled");
    });
    await expect(
      new DynamoDbTimelineStore(down.client, "projections").putIfNewer("u1", entry),
    ).rejects.toThrow("throttled");
  });

  it("reads back what it wrote, and refuses an item that is not an entry", async () => {
    const stored = client(() => ({ Item: { pk: "OWNER#u1", sk: "TIMELINE#n1", ...entry } }));
    expect(await new DynamoDbTimelineStore(stored.client, "projections").get("u1", "n1")).toEqual(
      entry,
    );
    expect(stored.sent[0]?.input).toMatchObject({ ConsistentRead: true });
    const odd = client(() => ({ Item: { ...entry, rank: 0 } }));
    await expect(
      new DynamoDbTimelineStore(odd.client, "projections").get("u1", "n1"),
    ).rejects.toThrow();
  });
});

describe("DynamoDbCounterStore requests", () => {
  const store = (fake: never) => new DynamoDbCounterStore(fake, "projections", 30, now);

  it("remembers the event and adds in one transaction, the marker first", async () => {
    const { client: fake, sent } = client();
    expect(await store(fake).addOnce("u1", "note:u1/n1#1", 1)).toBe("counted");
    expect(sent[0]).toBeInstanceOf(TransactWriteCommand);
    expect(sent[0]?.input).toEqual({
      TransactItems: [
        {
          Put: {
            TableName: "projections",
            Item: {
              pk: "OWNER#u1",
              sk: "COUNTED#note:u1/n1#1",
              // Thirty days after 2026-10-12T00:00:00Z, in seconds.
              expiresAt: 1_791_763_200 + 30 * 86_400,
            },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        {
          Update: {
            TableName: "projections",
            Key: { pk: "OWNER#u1", sk: "COUNT" },
            UpdateExpression: "ADD noteCount :delta",
            ExpressionAttributeValues: { ":delta": 1 },
          },
        },
      ],
    });
  });

  const cancelled = (codes: string[]) =>
    new TransactionCanceledException({
      message: "cancelled",
      $metadata: {},
      CancellationReasons: codes.map((Code) => ({ Code })),
    });

  it("reads a marker that is already there as counted before", async () => {
    const { client: fake } = client(() => {
      throw cancelled(["ConditionalCheckFailed", "None"]);
    });
    expect(await store(fake).addOnce("u1", "note:u1/n1#1", 1)).toBe("already_counted");
  });

  it("does not mistake another cancellation for that", async () => {
    for (const codes of [
      ["TransactionConflict", "None"],
      ["None", "ConditionalCheckFailed"],
      ["ThrottlingError", "None"],
    ]) {
      const { client: fake } = client(() => {
        throw cancelled(codes);
      });
      await expect(store(fake).addOnce("u1", "note:u1/n1#1", 1)).rejects.toThrow("cancelled");
    }
  });

  it("the naive addition is a single update with no memory", async () => {
    const { client: fake, sent } = client();
    await store(fake).add("u1", -1);
    expect(sent[0]).toBeInstanceOf(UpdateCommand);
    expect(sent[0]?.input).toEqual({
      TableName: "projections",
      Key: { pk: "OWNER#u1", sk: "COUNT" },
      UpdateExpression: "ADD noteCount :delta",
      ExpressionAttributeValues: { ":delta": -1 },
    });
  });

  it("reads zero for an owner nothing was counted for", async () => {
    expect(await store(client().client).get("u1")).toBe(0);
    expect(await store(client(() => ({ Item: { noteCount: 4 } })).client).get("u1")).toBe(4);
  });
});

describe("environment", () => {
  it("a consumer needs its table", () => {
    expect(parseConsumerEnv({ PROJECTIONS_TABLE: "projections" })).toEqual({
      PROJECTIONS_TABLE: "projections",
      LOG_LEVEL: "info",
    });
    expect(() => parseConsumerEnv({})).toThrow(/PROJECTIONS_TABLE/);
  });

  it("the shaping function needs nothing, and refuses a log level it does not know", () => {
    expect(parseShapeEnv({})).toEqual({ LOG_LEVEL: "info" });
    expect(() => parseShapeEnv({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});
