import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import { DynamoDbPermitLedger, InMemoryPermitLedger, permitDay } from "../src/permit-ledger.ts";

describe("permitDay", () => {
  it("is the UTC date, so the allowance turns over at the same moment for everyone", () => {
    expect(permitDay(new Date("2026-10-11T23:59:59.999Z"))).toBe("2026-10-11");
    expect(permitDay(new Date("2026-10-12T00:00:00.000Z"))).toBe("2026-10-12");
  });
});

describe("InMemoryPermitLedger", () => {
  it("hands out exactly max per owner and day", async () => {
    const ledger = new InMemoryPermitLedger();
    expect(await ledger.take("u1", "2026-10-11", 2)).toBe(true);
    expect(await ledger.take("u1", "2026-10-11", 2)).toBe(true);
    expect(await ledger.take("u1", "2026-10-11", 2)).toBe(false);
    expect(await ledger.take("u2", "2026-10-11", 2)).toBe(true);
    expect(await ledger.take("u1", "2026-10-12", 2)).toBe(true);
  });
});

// Pins the request. Whether DynamoDB honours it has not been run anywhere yet.
describe("DynamoDbPermitLedger requests", () => {
  it("counts and checks in one conditional update, in the owner's partition", async () => {
    const sent: UpdateCommand[] = [];
    const client = { send: async (command: UpdateCommand) => void sent.push(command) };
    const ledger = new DynamoDbPermitLedger(client as never, "notes-table");

    expect(await ledger.take("u1", "2026-10-11", 100)).toBe(true);
    expect(sent[0]).toBeInstanceOf(UpdateCommand);
    expect(sent[0]?.input).toEqual({
      TableName: "notes-table",
      // Neither NOTE# nor ATTACHMENT#: no list in the app returns this item.
      Key: { pk: "OWNER#u1", sk: "PERMITS#2026-10-11" },
      UpdateExpression: "ADD issued :one",
      ConditionExpression: "attribute_not_exists(issued) OR issued < :max",
      ExpressionAttributeValues: { ":one": 1, ":max": 100 },
    });
  });

  it("answers false when the condition fails, and passes any other failure on", async () => {
    const failing = (error: Error) =>
      new DynamoDbPermitLedger({ send: () => Promise.reject(error) } as never, "notes-table").take(
        "u1",
        "2026-10-11",
        100,
      );

    expect(
      await failing(
        new ConditionalCheckFailedException({
          message: "The conditional request failed",
          $metadata: {},
        }),
      ),
    ).toBe(false);
    // A throttled or failed write must not read as "allowance used up", nor as a free permit.
    await expect(failing(new Error("ProvisionedThroughputExceededException"))).rejects.toThrow();
  });
});
