import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DeleteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import type { Note } from "../src/contract.ts";
import { DynamoDbNoteRepository } from "../src/dynamodb-repository.ts";
import { encodeCursor } from "../src/repository.ts";

// Pins the requests that carry the guarantees. Whether DynamoDB honours them
// is what the DynamoDB Local and AWS runs are for.
type Command = PutCommand | GetCommand | QueryCommand | UpdateCommand | DeleteCommand;

function setup(respond: (command: Command) => unknown = () => ({}), maxNotesPerOwner?: number) {
  const sent: Command[] = [];
  const client = {
    send: async (command: Command) => {
      sent.push(command);
      return respond(command);
    },
  };
  // Only `send` is implemented, which is all the repository uses.
  const repository = new DynamoDbNoteRepository(client as never, "notes-table", maxNotesPerOwner);
  return { repository, sent };
}

const stored: Note = {
  id: "abc",
  title: "t",
  body: "b",
  version: 3,
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z",
};
const item = { pk: "OWNER#u1", sk: "NOTE#abc", ...stored };
const conditionFailed = () =>
  new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} });

describe("DynamoDbNoteRepository requests", () => {
  it("creates with a condition that forbids overwriting", async () => {
    const { repository, sent } = setup();
    await repository.create("u1", stored);
    expect(sent[0]).toBeInstanceOf(PutCommand);
    expect(sent[0]?.input).toMatchObject({
      TableName: "notes-table",
      Item: { pk: "OWNER#u1", sk: "NOTE#abc", version: 3 },
      ConditionExpression: "attribute_not_exists(pk)",
    });
  });

  it("reports a taken key as already_exists instead of throwing", async () => {
    const { repository } = setup(() => {
      throw conditionFailed();
    });
    expect(await repository.create("u1", stored)).toBe("already_exists");
  });

  it("writes only the note when it was given no limit", async () => {
    const { repository, sent } = setup();
    await repository.create("u1", stored);
    await repository.delete("u1", "abc");
    expect(sent.map((command) => command.constructor.name)).toEqual([
      "PutCommand",
      "DeleteCommand",
    ]);
  });

  it("takes a place with one conditional update before it writes the note", async () => {
    const { repository, sent } = setup(undefined, 100);
    expect(await repository.create("u1", stored)).toBe("created");
    expect(sent.map((command) => command.constructor.name)).toEqual([
      "UpdateCommand",
      "PutCommand",
    ]);
    expect(sent[0]?.input).toMatchObject({
      Key: { pk: "OWNER#u1", sk: "QUOTA" },
      UpdateExpression: "ADD noteCount :one",
      ConditionExpression: "attribute_not_exists(noteCount) OR noteCount < :max",
      ExpressionAttributeValues: { ":one": 1, ":max": 100 },
    });
  });

  it("writes no note when no place is left", async () => {
    const { repository, sent } = setup(() => {
      throw conditionFailed();
    }, 100);
    expect(await repository.create("u1", stored)).toBe("quota_exceeded");
    expect(sent).toHaveLength(1);
  });

  it("gives the place back when the key was taken", async () => {
    const { repository, sent } = setup((command) => {
      if (command instanceof PutCommand) {
        throw conditionFailed();
      }
      return {};
    }, 100);
    expect(await repository.create("u1", stored)).toBe("already_exists");
    expect(sent[2]?.input).toMatchObject({
      Key: { pk: "OWNER#u1", sk: "QUOTA" },
      UpdateExpression: "ADD noteCount :minusOne",
      ConditionExpression: "noteCount > :zero",
    });
  });

  it("keeps the place when it cannot tell whether the note was written", async () => {
    const { repository, sent } = setup((command) => {
      if (command instanceof PutCommand) {
        throw new Error("socket hang up");
      }
      return {};
    }, 100);
    await expect(repository.create("u1", stored)).rejects.toThrow(/socket/);
    expect(sent).toHaveLength(2);
  });

  it("gives a place back for a note it deleted, and none for a note that was not there", async () => {
    const there = setup(
      (command) => (command instanceof UpdateCommand ? {} : { Attributes: item }),
      100,
    );
    expect(await there.repository.delete("u1", "abc")).toBe(true);
    expect(there.sent.map((command) => command.constructor.name)).toEqual([
      "DeleteCommand",
      "UpdateCommand",
    ]);

    const gone = setup(() => ({}), 100);
    expect(await gone.repository.delete("u1", "abc")).toBe(false);
    expect(gone.sent).toHaveLength(1);
  });

  it("reads one note with a strongly consistent GetItem", async () => {
    const { repository, sent } = setup(() => ({ Item: item }));
    expect(await repository.get("u1", "abc")).toEqual(stored);
    expect(sent[0]?.input).toMatchObject({
      Key: { pk: "OWNER#u1", sk: "NOTE#abc" },
      ConsistentRead: true,
    });
  });

  it("updates only at the expected version", async () => {
    const { repository, sent } = setup(() => ({
      Attributes: { ...item, version: 4, title: "new" },
    }));
    const result = await repository.update("u1", "abc", {
      title: "new",
      body: "b",
      expectedVersion: 3,
      updatedAt: "2026-10-11T01:00:00.000Z",
    });
    expect(result).toMatchObject({ status: "updated", note: { version: 4 } });
    expect(sent[0]?.input).toMatchObject({
      ConditionExpression: "version = :expected",
      ExpressionAttributeValues: { ":expected": 3, ":next": 4 },
    });
  });

  it("turns a failed condition into a conflict with the stored note", async () => {
    const { repository } = setup((command) => {
      if (command instanceof UpdateCommand) {
        throw conditionFailed();
      }
      return { Item: { ...item, version: 5, title: "someone else" } };
    });
    const result = await repository.update("u1", "abc", {
      title: "mine",
      body: "b",
      expectedVersion: 3,
      updatedAt: "x",
    });
    expect(result).toMatchObject({
      status: "conflict",
      current: { version: 5, title: "someone else" },
    });
  });

  it("turns a failed condition on a missing note into not_found", async () => {
    const { repository } = setup((command) => {
      if (command instanceof UpdateCommand) {
        throw conditionFailed();
      }
      return {};
    });
    expect(
      await repository.update("u1", "gone", {
        title: "t",
        body: "",
        expectedVersion: 1,
        updatedAt: "x",
      }),
    ).toEqual({ status: "not_found" });
  });

  it("does not swallow errors that are not a failed condition", async () => {
    const { repository } = setup(() => {
      throw new Error("ProvisionedThroughputExceededException");
    });
    await expect(
      repository.update("u1", "abc", { title: "t", body: "", expectedVersion: 1, updatedAt: "x" }),
    ).rejects.toThrow(/Throughput/);
  });

  it("queries one owner's notes newest first and resumes from the cursor", async () => {
    const { repository, sent } = setup(() => ({
      Items: [item],
      LastEvaluatedKey: { pk: "OWNER#u1", sk: "NOTE#abc" },
    }));
    const page = await repository.list("u1", { limit: 1, cursor: encodeCursor("abd") });
    expect(sent[0]?.input).toMatchObject({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :note)",
      ExpressionAttributeValues: { ":pk": "OWNER#u1", ":note": "NOTE#" },
      ScanIndexForward: false,
      Limit: 1,
      ExclusiveStartKey: { pk: "OWNER#u1", sk: "NOTE#abd" },
    });
    expect(page.nextCursor).toBe(encodeCursor("abc"));
  });

  it("ends the list when DynamoDB returns no LastEvaluatedKey", async () => {
    const { repository } = setup(() => ({ Items: [item] }));
    expect((await repository.list("u1", { limit: 10 })).nextCursor).toBeNull();
  });

  it("refuses a stored item that is not a note", async () => {
    const { repository } = setup(() => ({ Item: { ...item, version: "three" } }));
    await expect(repository.get("u1", "abc")).rejects.toThrow();
  });
});
