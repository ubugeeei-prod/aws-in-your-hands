import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { GetCommand } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import { DynamoDbLedger } from "../src/dynamodb-ledger.ts";
import { parseEnv } from "../src/env.ts";
import { createParker } from "../src/sqs-sender.ts";
import { append, retitle } from "./harness.ts";

// These pin the requests the adapters send. Whether DynamoDB and SQS answer
// them as the chapter expects has not been run against either service.

const now = () => new Date("2026-10-13T00:00:00.000Z");
const expiresAt = Math.floor(now().getTime() / 1000) + 30 * 24 * 60 * 60;

function table(respond: () => unknown = () => ({})) {
  const sent: (TransactWriteCommand | GetCommand)[] = [];
  const client = {
    send: async (command: TransactWriteCommand | GetCommand) => {
      sent.push(command);
      return respond();
    },
  };
  return { ledger: new DynamoDbLedger(client as never, "edits", 30, now), sent };
}

const cancelled = (...codes: string[]) =>
  new TransactionCanceledException({
    message: "Transaction cancelled",
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

describe("DynamoDbLedger requests", () => {
  it("writes the marker and the change in one transaction", async () => {
    const { ledger, sent } = table();
    expect(await ledger.apply(append("milk", { commandId: "c-1" }))).toBe("applied");
    expect(sent[0]).toBeInstanceOf(TransactWriteCommand);
    expect(sent[0]?.input).toEqual({
      TransactItems: [
        {
          Put: {
            TableName: "edits",
            Item: { pk: "COMMAND#alice/n1/c-1", expiresAt },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        {
          Update: {
            TableName: "edits",
            Key: { pk: "NOTE#alice/n1" },
            UpdateExpression:
              "SET #lines = list_append(if_not_exists(#lines, :none), :line) ADD #applied :one",
            ConditionExpression: "attribute_not_exists(#lines) OR size(#lines) < :max",
            ExpressionAttributeNames: { "#lines": "lines", "#applied": "applied" },
            ExpressionAttributeValues: { ":line": ["milk"], ":none": [], ":one": 1, ":max": 200 },
          },
        },
      ],
    });
  });

  it("sets a title without a condition on the note", async () => {
    const { ledger, sent } = table();
    await ledger.apply(retitle("Shopping"));
    const input = sent[0]?.input as TransactWriteCommand["input"];
    expect(input.TransactItems?.[1]?.Update).toEqual({
      TableName: "edits",
      Key: { pk: "NOTE#alice/n1" },
      UpdateExpression: "SET #title = :title ADD #applied :one",
      ExpressionAttributeNames: { "#title": "title", "#applied": "applied" },
      ExpressionAttributeValues: { ":title": "Shopping", ":one": 1 },
    });
  });

  it("reads a refused marker as done before, and a refused note as full", async () => {
    const seen = table(() => {
      throw cancelled("ConditionalCheckFailed", "None");
    });
    expect(await seen.ledger.apply(append("milk"))).toBe("already_applied");
    const full = table(() => {
      throw cancelled("None", "ConditionalCheckFailed");
    });
    expect(await full.ledger.apply(append("milk"))).toBe("refused");
  });

  it("passes on every other failure, so the message is delivered again", async () => {
    const conflict = table(() => {
      throw cancelled("None", "TransactionConflict");
    });
    await expect(conflict.ledger.apply(append("milk"))).rejects.toThrow("Transaction cancelled");
    const down = table(() => {
      throw new Error("timeout");
    });
    await expect(down.ledger.apply(append("milk"))).rejects.toThrow("timeout");
  });

  it("reads a note with a consistent read, and fills in what was never set", async () => {
    const { ledger, sent } = table(() => ({
      Item: { pk: "NOTE#alice/n1", applied: 1, title: "T" },
    }));
    expect(await ledger.get("alice", "n1")).toEqual({ title: "T", lines: [], applied: 1 });
    expect(sent[0]?.input).toEqual({
      TableName: "edits",
      Key: { pk: "NOTE#alice/n1" },
      ConsistentRead: true,
    });
    expect(await table(() => ({})).ledger.get("alice", "n1")).toBeUndefined();
  });
});

describe("parking a message", () => {
  it("sends it to the dead-letter queue in its own group, named by its message ID", async () => {
    const sent: SendMessageCommand[] = [];
    const park = createParker(
      { send: async (command: SendMessageCommand) => void sent.push(command) } as never,
      "https://queue.test/dead.fifo",
    );
    await park(
      { messageId: "m-1", body: "not JSON", attributes: { MessageGroupId: "alice/n1" } },
      "not_json",
    );
    expect(sent[0]).toBeInstanceOf(SendMessageCommand);
    expect(sent[0]?.input).toEqual({
      QueueUrl: "https://queue.test/dead.fifo",
      MessageBody: "not JSON",
      MessageGroupId: "alice/n1",
      MessageDeduplicationId: "m-1",
      MessageAttributes: { parked: { DataType: "String", StringValue: "not_json" } },
    });
  });
});

describe("the function's environment", () => {
  it("needs the table and the dead-letter queue", () => {
    expect(
      parseEnv({ TABLE_NAME: "edits", DEAD_LETTER_QUEUE_URL: "https://queue.test/dead.fifo" }),
    ).toEqual({
      TABLE_NAME: "edits",
      DEAD_LETTER_QUEUE_URL: "https://queue.test/dead.fifo",
      LOG_LEVEL: "info",
    });
    expect(() => parseEnv({ TABLE_NAME: "edits" })).toThrow("DEAD_LETTER_QUEUE_URL");
  });
});
