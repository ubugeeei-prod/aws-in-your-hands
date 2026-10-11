import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";
import { DynamoDbNotificationStore } from "../src/dynamodb-store.ts";

// Pins the requests that carry the guarantees. Whether DynamoDB honours them
// is what a run against DynamoDB Local or AWS would show; neither was done.
type Command = PutCommand | GetCommand | UpdateCommand;

function setup(respond: (command: Command) => unknown = () => ({})) {
  const sent: Command[] = [];
  const client = {
    send: async (command: Command) => {
      sent.push(command);
      return respond(command);
    },
  };
  return { store: new DynamoDbNotificationStore(client as never, "mail-table"), sent };
}

const claim = {
  notificationId: "share-1",
  to: "recipient@example.com",
  fingerprint: "abc",
  at: "2026-10-11T00:00:00.000Z",
  expiresAt: 1_800_000_000,
};
const stored = {
  pk: "NOTIFICATION#share-1",
  notificationId: "share-1",
  to: claim.to,
  fingerprint: "abc",
  state: "sent",
  claimedAt: claim.at,
  updatedAt: claim.at,
  expiresAt: claim.expiresAt,
};
const conditionFailed = () =>
  new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} });

describe("DynamoDbNotificationStore requests", () => {
  it("claims with a condition: absent, or rejected for the same mail", async () => {
    const { store, sent } = setup();
    expect(await store.claim(claim)).toEqual({ claimed: true });
    expect(sent[0]).toBeInstanceOf(PutCommand);
    expect(sent[0]?.input).toMatchObject({
      TableName: "mail-table",
      Item: { pk: "NOTIFICATION#share-1", state: "claimed", fingerprint: "abc", expiresAt: 1_800_000_000 },
      ConditionExpression: "attribute_not_exists(pk) OR (#state = :rejected AND fingerprint = :fingerprint)",
      ExpressionAttributeNames: { "#state": "state" },
      ExpressionAttributeValues: { ":rejected": "rejected", ":fingerprint": "abc" },
    });
  });

  it("returns the existing record when the claim is taken, read consistently", async () => {
    const { store, sent } = setup((command) => {
      if (command instanceof PutCommand) {
        throw conditionFailed();
      }
      return { Item: stored };
    });
    expect(await store.claim(claim)).toMatchObject({ claimed: false, existing: { state: "sent" } });
    expect(sent[1]?.input).toMatchObject({ Key: { pk: "NOTIFICATION#share-1" }, ConsistentRead: true });
  });

  it("does not report a claim when the write failed for another reason", async () => {
    const { store } = setup(() => {
      throw new Error("ProvisionedThroughputExceededException");
    });
    await expect(store.claim(claim)).rejects.toThrow(/Throughput/);
  });

  it("advances only from the states the transition table allows", async () => {
    const { store, sent } = setup();
    expect(await store.advance("share-1", "sent", { at: "t1", messageId: "m-1" })).toBe(true);
    expect(await store.advance("share-1", "delivered", { at: "t2" })).toBe(true);

    expect(sent[0]?.input).toMatchObject({
      Key: { pk: "NOTIFICATION#share-1" },
      UpdateExpression: "SET #state = :next, updatedAt = :at, messageId = :messageId",
      ConditionExpression: "#state IN (:from0)",
      ExpressionAttributeValues: { ":next": "sent", ":from0": "claimed", ":messageId": "m-1" },
    });
    expect(sent[1]?.input).toMatchObject({
      UpdateExpression: "SET #state = :next, updatedAt = :at",
      ConditionExpression: "#state IN (:from0, :from1, :from2)",
      ExpressionAttributeValues: { ":from0": "claimed", ":from1": "rejected", ":from2": "sent" },
    });
  });

  it("reports a refused transition as false instead of throwing", async () => {
    const { store } = setup(() => {
      throw conditionFailed();
    });
    expect(await store.advance("share-1", "sent", { at: "t" })).toBe(false);
  });

  it("stores a suppression under the lower-cased address, with no expiry", async () => {
    const { store, sent } = setup();
    await store.suppress({
      address: "Recipient@Example.com",
      reason: "bounce",
      suppressedAt: claim.at,
      feedbackId: "f-1",
    });
    expect(sent[0]?.input).toMatchObject({
      Item: { pk: "SUPPRESSION#recipient@example.com", address: "recipient@example.com", reason: "bounce" },
    });
    expect(sent[0]?.input).not.toHaveProperty("ConditionExpression");
    expect((sent[0] as PutCommand).input.Item).not.toHaveProperty("expiresAt");
  });

  it("looks a suppression up by the same key", async () => {
    const { store, sent } = setup(() => ({
      Item: {
        pk: "SUPPRESSION#recipient@example.com",
        address: "recipient@example.com",
        reason: "complaint",
        suppressedAt: claim.at,
        feedbackId: "f-1",
      },
    }));
    expect(await store.findSuppression("RECIPIENT@example.com")).toMatchObject({ reason: "complaint" });
    expect(sent[0]?.input).toMatchObject({ Key: { pk: "SUPPRESSION#recipient@example.com" } });
  });

  it("refuses a stored item that is not a notification record", async () => {
    const { store } = setup(() => ({ Item: { ...stored, state: "finished" } }));
    await expect(store.get("share-1")).rejects.toThrow();
  });
});
