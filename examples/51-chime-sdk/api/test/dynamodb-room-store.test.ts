import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import { DynamoDbRoomStore } from "../src/dynamodb-room-store.ts";

// Pins the requests. Whether DynamoDB accepts and honours these expressions has not been
// run anywhere: there is no DynamoDB Local without Docker, and nothing here calls AWS.
type Command = PutCommand | GetCommand | UpdateCommand | DeleteCommand;

function setup(respond: (command: Command) => unknown = () => ({})) {
  const sent: Command[] = [];
  const client = {
    send: async (command: Command) => {
      sent.push(command);
      return respond(command);
    },
  };
  return { store: new DynamoDbRoomStore(client as never, "notes-table"), sent };
}

const conditionFailed = () => {
  throw new ConditionalCheckFailedException({
    message: "The conditional request failed",
    $metadata: {},
  });
};
const KEY = { pk: "ROOM#r1", sk: "ROOM" };

describe("DynamoDbRoomStore requests", () => {
  it("creates a room in a partition of its own, with members as a set, without overwriting", async () => {
    const { store, sent } = setup();
    await store.create({ id: "r1", owner: "alice", members: ["alice"], closed: false, seats: {} });
    expect(sent[0]).toBeInstanceOf(PutCommand);
    expect(sent[0]?.input).toMatchObject({
      TableName: "notes-table",
      Item: { ...KEY, owner: "alice", members: new Set(["alice"]), closed: false, seats: {} },
      ConditionExpression: "attribute_not_exists(pk)",
    });
  });

  it("reads a room with a consistent read and turns the set back into a list", async () => {
    const { store, sent } = setup(() => ({
      Item: {
        ...KEY,
        id: "r1",
        owner: "alice",
        members: new Set(["alice", "bob"]),
        closed: false,
        meetingId: "m1",
        seats: { alice: "a1" },
      },
    }));
    expect(await store.get("r1")).toEqual({
      id: "r1",
      owner: "alice",
      members: ["alice", "bob"],
      closed: false,
      meetingId: "m1",
      seats: { alice: "a1" },
    });
    expect(sent[0]?.input).toMatchObject({ Key: KEY, ConsistentRead: true });
  });

  it("refuses an item that is not a room", async () => {
    const { store } = setup(() => ({
      Item: { ...KEY, id: "r1", owner: "alice", members: ["alice"] },
    }));
    await expect(store.get("r1")).rejects.toThrow();
  });

  it("seats a user only as a member of an open room, in this meeting, from the seat it saw", async () => {
    const { store, sent } = setup();
    await store.setSeat("r1", { meetingId: "m1", sub: "bob", expected: "a0", next: "a1" });
    await store.setSeat("r1", { meetingId: "m1", sub: "bob", expected: undefined, next: "a1" });
    expect(sent[0]?.input).toMatchObject({
      Key: KEY,
      UpdateExpression: "SET seats.#sub = :next",
      ConditionExpression:
        "meetingId = :meeting AND seats.#sub = :expected AND closed = :open AND contains(members, :sub)",
      ExpressionAttributeNames: { "#sub": "bob" },
      ExpressionAttributeValues: {
        ":meeting": "m1",
        ":expected": "a0",
        ":next": "a1",
        ":open": false,
        ":sub": "bob",
      },
    });
    expect(sent[1]?.input).toMatchObject({
      ConditionExpression:
        "meetingId = :meeting AND attribute_not_exists(seats.#sub) AND closed = :open AND contains(members, :sub)",
    });
  });

  it("clears a seat without asking for membership", async () => {
    const { store, sent } = setup();
    await store.setSeat("r1", { meetingId: "m1", sub: "bob", expected: "a1", next: undefined });
    expect(sent[0]?.input).toMatchObject({
      UpdateExpression: "REMOVE seats.#sub",
      ConditionExpression: "meetingId = :meeting AND seats.#sub = :expected",
      ExpressionAttributeValues: { ":meeting": "m1", ":expected": "a1" },
    });
  });

  it("swaps the meeting from the value it saw, empties the seats, and needs an open room to set one", async () => {
    const { store, sent } = setup();
    await store.setMeeting("r1", undefined, "m1");
    await store.setMeeting("r1", "m1", "m2");
    await store.setMeeting("r1", "m2", undefined);
    expect(sent.map((command) => command.input)).toMatchObject([
      {
        UpdateExpression: "SET meetingId = :next, seats = :none",
        ConditionExpression:
          "attribute_exists(pk) AND attribute_not_exists(meetingId) AND closed = :open",
        ExpressionAttributeValues: { ":none": {}, ":next": "m1", ":open": false },
      },
      {
        ConditionExpression: "attribute_exists(pk) AND meetingId = :expected AND closed = :open",
        ExpressionAttributeValues: { ":expected": "m1", ":next": "m2" },
      },
      {
        UpdateExpression: "REMOVE meetingId SET seats = :none",
        ConditionExpression: "attribute_exists(pk) AND meetingId = :expected",
        ExpressionAttributeValues: { ":none": {}, ":expected": "m2" },
      },
    ]);
  });

  it("adds a member only to an open room with space, and never creates a room by doing so", async () => {
    const { store, sent } = setup();
    expect(await store.addMember("r1", "bob", 10)).toBe(true);
    expect(sent[0]?.input).toMatchObject({
      UpdateExpression: "ADD members :one",
      ConditionExpression:
        "attribute_exists(pk) AND closed = :open AND (contains(members, :sub) OR size(members) < :max)",
      ExpressionAttributeValues: {
        ":one": new Set(["bob"]),
        ":sub": "bob",
        ":open": false,
        ":max": 10,
      },
    });
  });

  it("reports a failed condition as false, and any other error as an error", async () => {
    const refusing = setup(conditionFailed).store;
    expect(await refusing.addMember("r1", "bob", 10)).toBe(false);
    expect(await refusing.setMeeting("r1", undefined, "m1")).toBe(false);
    expect(
      await refusing.setSeat("r1", {
        meetingId: "m1",
        sub: "bob",
        expected: undefined,
        next: "a1",
      }),
    ).toBe(false);
    // Closing or leaving a room that is already gone is not a failure.
    await refusing.close("r1");
    await refusing.removeMember("r1", "bob");

    const broken = setup(() => {
      throw new Error("ProvisionedThroughputExceededException");
    }).store;
    await expect(broken.setMeeting("r1", undefined, "m1")).rejects.toThrow();
  });

  it("closes, removes a member and deletes by key", async () => {
    const { store, sent } = setup();
    await store.close("r1");
    await store.removeMember("r1", "bob");
    await store.delete("r1");
    expect(sent[0]?.input).toMatchObject({
      UpdateExpression: "SET closed = :closed",
      ConditionExpression: "attribute_exists(pk)",
    });
    expect(sent[1]?.input).toMatchObject({
      UpdateExpression: "DELETE members :one",
      ExpressionAttributeValues: { ":one": new Set(["bob"]) },
    });
    expect(sent[2]).toBeInstanceOf(DeleteCommand);
    expect(sent[2]?.input).toMatchObject({ Key: KEY });
  });
});
