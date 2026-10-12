import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import { PutCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import {
  conditionExpression,
  DynamoDbTable,
  queryInput,
  transactItems,
  updateExpression,
} from "../src/dynamodb-table.ts";
import { createNotebook } from "../src/notebook.ts";
import { attachment, note } from "./support.ts";

// Pins the requests that carry the guarantees. Whether DynamoDB honours them
// is what the DynamoDB Local run, and a run on AWS, are for.
function setup(respond: (command: { input: unknown }) => unknown = () => ({})) {
  const sent: { input: Record<string, unknown> }[] = [];
  const client = {
    send: async (command: { input: Record<string, unknown> }) => {
      sent.push(command);
      return respond(command);
    },
  };
  // Only `send` is implemented, which is all the adapter uses.
  return { table: new DynamoDbTable(client as never, "t"), sent };
}

const cancelled = (...codes: string[]) =>
  new TransactionCanceledException({
    message: "Transaction cancelled",
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

describe("expressions", () => {
  it("say `no item under this key` through the key attribute", () => {
    expect(conditionExpression({ kind: "not_exists" })).toEqual({
      ConditionExpression: "attribute_not_exists(pk)",
    });
  });

  it("never put an attribute name in the expression text", () => {
    expect(
      conditionExpression({ kind: "missing_or_less_than", attribute: "count", value: 3 }),
    ).toEqual({
      ConditionExpression: "attribute_not_exists(#c) OR #c < :c",
      ExpressionAttributeNames: { "#c": "count" },
      ExpressionAttributeValues: { ":c": 3 },
    });
    expect(
      updateExpression({ set: { size: 1, name: "x" }, remove: ["slug"], add: { count: -1 } }),
    ).toEqual({
      UpdateExpression: "SET #s0 = :s0, #s1 = :s1 REMOVE #r0 ADD #a0 :a0",
      names: { "#s0": "size", "#s1": "name", "#r0": "slug", "#a0": "count" },
      values: { ":s0": 1, ":s1": "x", ":a0": -1 },
    });
  });

  it("query the index by its own key attributes, and the table by pk and sk", () => {
    expect(
      queryInput("t", {
        index: "gsi1",
        pk: "OWNER#u1",
        sk: { beginsWith: "UPDATED#" },
        descending: true,
        limit: 5,
      }),
    ).toEqual({
      TableName: "t",
      IndexName: "gsi1",
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk)",
      ExpressionAttributeNames: { "#pk": "gsi1pk", "#sk": "gsi1sk" },
      ExpressionAttributeValues: { ":pk": "OWNER#u1", ":sk": "UPDATED#" },
      ScanIndexForward: false,
      Limit: 5,
    });
    expect(
      queryInput("t", {
        pk: "OWNER#u1",
        sk: { between: ["NOTE#a", "NOTE#a#~"] },
        consistent: true,
      }),
    ).toEqual({
      TableName: "t",
      KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :from AND :to",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": "OWNER#u1", ":from": "NOTE#a", ":to": "NOTE#a#~" },
      ScanIndexForward: true,
      ConsistentRead: true,
    });
  });

  it("send a check as a ConditionCheck, with no empty maps", () => {
    expect(
      transactItems("t", [
        { kind: "check", key: { pk: "p", sk: "s" }, condition: { kind: "exists" } },
        { kind: "delete", key: { pk: "p", sk: "x" } },
      ]),
    ).toEqual([
      {
        ConditionCheck: {
          TableName: "t",
          Key: { pk: "p", sk: "s" },
          ConditionExpression: "attribute_exists(pk)",
        },
      },
      { Delete: { TableName: "t", Key: { pk: "p", sk: "x" } } },
    ]);
  });
});

describe("DynamoDbTable", () => {
  it("answers a failed condition as a value, and lets any other error through", async () => {
    const failing = setup(() => {
      throw new ConditionalCheckFailedException({ message: "failed", $metadata: {} });
    });
    expect(await failing.table.write({ kind: "put", item: { pk: "p", sk: "s" } })).toBe(
      "condition_failed",
    );

    const broken = setup(() => {
      throw new Error("ProvisionedThroughputExceededException");
    });
    await expect(broken.table.write({ kind: "put", item: { pk: "p", sk: "s" } })).rejects.toThrow();
  });

  it("maps a cancelled transaction to one reason per item, in order", async () => {
    const { table } = setup(() => {
      throw cancelled("None", "ConditionalCheckFailed", "TransactionConflict");
    });
    const writes = ["a", "b", "c"].map((sk) => ({ kind: "put" as const, item: { pk: "p", sk } }));
    expect(await table.transact(writes)).toEqual({
      ok: false,
      reasons: ["none", "condition_failed", "conflict"],
    });
  });

  it("does not turn a reason it has no answer for into a refusal", async () => {
    const { table } = setup(() => {
      throw cancelled("None", "ThrottlingError");
    });
    const writes = ["a", "b"].map((sk) => ({ kind: "put" as const, item: { pk: "p", sk } }));
    await expect(table.transact(writes)).rejects.toThrow(TransactionCanceledException);
  });
});

describe("the notebook's requests", () => {
  it("create is one transaction: the note unless it exists, the counter unless it is full", async () => {
    const { table, sent } = setup();
    await createNotebook({ table, maxNotes: 100 }).create(
      "u1",
      note("n1", { tags: ["trip"], slug: "s" }),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(TransactWriteCommand);
    expect(sent[0]?.input["TransactItems"]).toMatchObject([
      {
        Put: {
          Item: {
            pk: "OWNER#u1",
            sk: "NOTE#n1",
            gsi1pk: "OWNER#u1",
            gsi1sk: "UPDATED#2026-10-13T00:00:00.000Z#n1",
          },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
      {
        Update: {
          Key: { pk: "OWNER#u1", sk: "QUOTA" },
          UpdateExpression: "ADD #a0 :a0",
          ConditionExpression: "attribute_not_exists(#c) OR #c < :c",
          ExpressionAttributeNames: { "#a0": "noteCount", "#c": "noteCount" },
          ExpressionAttributeValues: { ":a0": 1, ":c": 100 },
        },
      },
      {
        Put: {
          Item: { sk: "SLUG#s", noteId: "n1" },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
      { Put: { Item: { sk: "TAG#trip#NOTE#n1", title: "note n1" } } },
    ]);
  });

  it("only a note item carries the index attributes", async () => {
    const { table, sent } = setup();
    await createNotebook({ table }).create("u1", note("n1", { tags: ["trip"], slug: "s" }));
    await createNotebook({ table }).attach("u1", attachment("n1", "a1"));

    const puts = sent
      .flatMap(
        (command) =>
          command.input["TransactItems"] as { Put?: { Item: Record<string, unknown> } }[],
      )
      .flatMap((item) => (item.Put === undefined ? [] : [item.Put.Item]));
    expect(
      puts.filter((item) => "gsi1pk" in item || "gsi1sk" in item).map((item) => item["sk"]),
    ).toEqual(["NOTE#n1"]);
  });

  it("attach checks the note inside the transaction that writes the attachment", async () => {
    const { table, sent } = setup();
    await createNotebook({ table }).attach("u1", attachment("n1", "a1"));
    expect(sent[0]?.input["TransactItems"]).toMatchObject([
      {
        ConditionCheck: {
          Key: { pk: "OWNER#u1", sk: "NOTE#n1" },
          ConditionExpression: "attribute_exists(pk)",
        },
      },
      {
        Put: {
          Item: { sk: "NOTE#n1#ATTACHMENT#a1" },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
    ]);
  });

  it("an edit that touches only the note is an UpdateItem conditional on the version", async () => {
    const stored = { pk: "OWNER#u1", sk: "NOTE#n1", ...note("n1", { tags: ["trip"] }) };
    const { table, sent } = setup((command) =>
      "Key" in (command.input as object) && !(command instanceof UpdateCommand)
        ? { Item: stored }
        : {},
    );
    await createNotebook({ table }).update("u1", "n1", {
      title: stored.title,
      body: "more",
      tags: ["trip"],
      expectedVersion: 1,
      updatedAt: "2026-10-13T01:00:00.000Z",
    });

    const update = sent.find((command) => command instanceof UpdateCommand);
    expect(update?.input).toMatchObject({
      Key: { pk: "OWNER#u1", sk: "NOTE#n1" },
      ConditionExpression: "#c = :c",
      ExpressionAttributeNames: { "#c": "version" },
      ExpressionAttributeValues: { ":c": 1 },
    });
    expect(sent.some((command) => command instanceof TransactWriteCommand)).toBe(false);
    expect(sent.some((command) => command instanceof PutCommand)).toBe(false);
  });

  it("the collection is one strongly consistent Query, and the recent list reads the index", async () => {
    const { table, sent } = setup(() => ({ Items: [] }));
    const notebook = createNotebook({ table });
    await notebook.getWithAttachments("u1", "n1");
    await notebook.listRecent("u1", { limit: 20 });

    expect(sent).toHaveLength(2);
    expect(sent[0]?.input).toMatchObject({
      KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :from AND :to",
      ConsistentRead: true,
    });
    expect(sent[0]?.input).not.toHaveProperty("IndexName");
    expect(sent[1]?.input).toMatchObject({ IndexName: "gsi1", ScanIndexForward: false, Limit: 20 });
    expect(sent[1]?.input).not.toHaveProperty("ConsistentRead");
  });
});
