import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { GetCommand } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import { DynamoDbCacheStore, DynamoDbCounterStore } from "../src/dynamodb-store.ts";

// Pins the requests that carry the guarantees. Whether DynamoDB honours them
// is what `vp run kv:test:local` (DynamoDB Local) and a deployed run are for.
type Command = UpdateCommand | GetCommand | PutCommand | DeleteCommand;

function fakeClient(respond: (command: Command) => unknown = () => ({})) {
  const sent: Command[] = [];
  const client = {
    send: async (command: Command) => {
      sent.push(command);
      return respond(command);
    },
  };
  // Only `send` is implemented, which is all the stores use.
  return { client: client as never, sent };
}

const conditionFailed = () =>
  new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} });

const window = {
  subject: "client-1",
  windowStart: 1_760_000_040_000,
  expiresAt: 1_760_000_160_500,
};

describe("DynamoDbCounterStore requests", () => {
  it("adds and checks the cap in one UpdateItem, with no read before it", async () => {
    const { client, sent } = fakeClient(() => ({ Attributes: { hits: 3 } }));
    const result = await new DynamoDbCounterStore(client, "kv-table").incrementBelow(window, 5);

    expect(result).toEqual({ accepted: true, count: 3 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(UpdateCommand);
    expect(sent[0]?.input).toMatchObject({
      TableName: "kv-table",
      Key: { pk: "RATE#client-1", sk: "WINDOW#1760000040000" },
      UpdateExpression: "ADD #hits :one SET #ttl = :ttl",
      ConditionExpression: "attribute_not_exists(#hits) OR #hits < :cap",
      ExpressionAttributeNames: { "#hits": "hits", "#ttl": "expiresAt" },
      ExpressionAttributeValues: { ":one": 1, ":cap": 5 },
      ReturnValues: "UPDATED_NEW",
    });
  });

  it("stores the expiry as whole Unix seconds, rounded up", async () => {
    const { client, sent } = fakeClient(() => ({ Attributes: { hits: 1 } }));
    await new DynamoDbCounterStore(client, "kv-table").incrementBelow(window, 5);
    expect(sent[0]?.input).toMatchObject({ ExpressionAttributeValues: { ":ttl": 1_760_000_161 } });
  });

  it("reports a failed condition as a refusal, and nothing else as one", async () => {
    const full = fakeClient(() => {
      throw conditionFailed();
    });
    expect(
      await new DynamoDbCounterStore(full.client, "kv-table").incrementBelow(window, 5),
    ).toEqual({
      accepted: false,
    });

    const throttled = fakeClient(() => {
      throw new Error("ProvisionedThroughputExceededException");
    });
    await expect(
      new DynamoDbCounterStore(throttled.client, "kv-table").incrementBelow(window, 5),
    ).rejects.toThrow("ProvisionedThroughputExceeded");
  });

  it("reads a window with a strongly consistent GetItem", async () => {
    const { client, sent } = fakeClient(() => ({
      Item: { pk: "RATE#client-1", sk: "WINDOW#1", hits: 4 },
    }));
    expect(await new DynamoDbCounterStore(client, "kv-table").read(window)).toBe(4);
    expect(sent[0]?.input).toMatchObject({ ConsistentRead: true });
  });
});

describe("DynamoDbCacheStore and TTL", () => {
  const NOW = 1_760_000_100_000;
  const stored = (expiresAtMs: number) => ({
    Item: {
      pk: "CACHE#list",
      sk: "VALUE",
      payload: "v1",
      expiresAtMs,
      expiresAt: Math.ceil(expiresAtMs / 1000),
    },
  });

  // #region ttl-test
  it("does not return an expired item that DynamoDB has not deleted yet", async () => {
    // GetItem still finds it: TTL deletion runs in the background, typically within days.
    const { client } = fakeClient(() => stored(NOW - 1));
    expect(await new DynamoDbCacheStore(client, "kv-table").get("list", NOW)).toBeUndefined();
  });

  it("returns an item up to the millisecond before it expires", async () => {
    const { client } = fakeClient(() => stored(NOW + 1));
    expect(await new DynamoDbCacheStore(client, "kv-table").get("list", NOW)).toBe("v1");
  });
  // #endregion ttl-test

  it("treats an item of an unknown shape as a miss", async () => {
    const { client } = fakeClient(() => ({
      Item: { pk: "CACHE#list", sk: "VALUE", body: "old format" },
    }));
    expect(await new DynamoDbCacheStore(client, "kv-table").get("list", NOW)).toBeUndefined();
  });

  it("writes the precise expiry for reads and whole seconds for the TTL process", async () => {
    const { client, sent } = fakeClient();
    await new DynamoDbCacheStore(client, "kv-table").set("list", {
      value: "v1",
      expiresAt: NOW + 30_250,
    });
    expect(sent[0]).toBeInstanceOf(PutCommand);
    expect(sent[0]?.input).toMatchObject({
      Item: {
        pk: "CACHE#list",
        sk: "VALUE",
        payload: "v1",
        expiresAtMs: NOW + 30_250,
        expiresAt: 1_760_000_131,
      },
    });
  });

  it("takes a lock only if none exists or the existing one has expired", async () => {
    const { client, sent } = fakeClient();
    expect(
      await new DynamoDbCacheStore(client, "kv-table").tryLock("list", "a", NOW + 5_000, NOW),
    ).toBe(true);
    expect(sent[0]?.input).toMatchObject({
      Item: { pk: "CACHE#list", sk: "LOCK", owner: "a", expiresAtMs: NOW + 5_000 },
      ConditionExpression: "attribute_not_exists(pk) OR #expiresAtMs <= :now",
      ExpressionAttributeValues: { ":now": NOW },
    });

    const held = fakeClient(() => {
      throw conditionFailed();
    });
    expect(
      await new DynamoDbCacheStore(held.client, "kv-table").tryLock("list", "b", NOW + 5_000, NOW),
    ).toBe(false);
  });

  it("releases a lock only for its owner", async () => {
    const { client, sent } = fakeClient();
    await new DynamoDbCacheStore(client, "kv-table").unlock("list", "a");
    expect(sent[0]).toBeInstanceOf(DeleteCommand);
    expect(sent[0]?.input).toMatchObject({
      Key: { pk: "CACHE#list", sk: "LOCK" },
      ConditionExpression: "#owner = :owner",
      ExpressionAttributeValues: { ":owner": "a" },
    });

    const taken = fakeClient(() => {
      throw conditionFailed();
    });
    await expect(
      new DynamoDbCacheStore(taken.client, "kv-table").unlock("list", "a"),
    ).resolves.toBeUndefined();
  });
});
