import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";
import type { Note } from "../src/contract.ts";
import { DynamoDbNoteRepository } from "../src/dynamodb-repository.ts";
import { encodeCursor } from "../src/repository.ts";

// Pins the requests that carry the guarantees. Whether DynamoDB honours them
// is what the DynamoDB Local and AWS runs are for.
type Command = PutCommand | GetCommand | QueryCommand | UpdateCommand | DeleteCommand;

function setup(respond: (command: Command) => unknown = () => ({})) {
  const sent: Command[] = [];
  const client = {
    send: async (command: Command) => {
      sent.push(command);
      return respond(command);
    },
  };
  // Only `send` is implemented, which is all the repository uses.
  const repository = new DynamoDbNoteRepository(client as never, "notes-table");
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

  it("reads one note with a strongly consistent GetItem", async () => {
    const { repository, sent } = setup(() => ({ Item: item }));
    expect(await repository.get("u1", "abc")).toEqual(stored);
    expect(sent[0]?.input).toMatchObject({ Key: { pk: "OWNER#u1", sk: "NOTE#abc" }, ConsistentRead: true });
  });

  it("updates only at the expected version", async () => {
    const { repository, sent } = setup(() => ({ Attributes: { ...item, version: 4, title: "new" } }));
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
    expect(result).toMatchObject({ status: "conflict", current: { version: 5, title: "someone else" } });
  });

  it("turns a failed condition on a missing note into not_found", async () => {
    const { repository } = setup((command) => {
      if (command instanceof UpdateCommand) {
        throw conditionFailed();
      }
      return {};
    });
    expect(await repository.update("u1", "gone", { title: "t", body: "", expectedVersion: 1, updatedAt: "x" })).toEqual(
      { status: "not_found" },
    );
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
    const { repository, sent } = setup(() => ({ Items: [item], LastEvaluatedKey: { pk: "OWNER#u1", sk: "NOTE#abc" } }));
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
