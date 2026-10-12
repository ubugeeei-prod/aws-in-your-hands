import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { type DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import type { UsageLedger } from "./budget.ts";

const itemSchema = v.object({ microUsd: v.pipe(v.number(), v.integer()) });

/** A day's item is of no use once the day is over. DynamoDB removes it some time after this. */
const KEEP_DAYS = 35;

// #region ledger
export class DynamoDbUsageLedger implements UsageLedger {
  readonly #client: Pick<DynamoDBDocumentClient, "send">;
  readonly #tableName: string;

  constructor(client: Pick<DynamoDBDocumentClient, "send">, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  #key = (owner: string, day: string) => ({ owner, day });

  async reserve(owner: string, day: string, amount: number, limit: number) {
    try {
      await this.#client.send(
        new UpdateCommand({
          TableName: this.#tableName,
          Key: this.#key(owner, day),
          UpdateExpression:
            "ADD microUsd :amount SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
          // Checked and added as a single step. Reading the total first would let two
          // requests both see room for one.
          ConditionExpression: "attribute_not_exists(microUsd) OR microUsd <= :room",
          ExpressionAttributeValues: {
            ":amount": amount,
            ":room": limit - amount,
            ":expiresAt": Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + KEEP_DAYS * 86_400,
          },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }
      throw error;
    }
  }

  async settle(owner: string, day: string, reserved: number, spent: number) {
    await this.#client.send(
      new UpdateCommand({
        TableName: this.#tableName,
        Key: this.#key(owner, day),
        // ADD with a negative number gives back what was set aside and not used.
        UpdateExpression: "ADD microUsd :delta",
        ExpressionAttributeValues: { ":delta": spent - reserved },
      }),
    );
  }

  async spent(owner: string, day: string) {
    const { Item } = await this.#client.send(
      new GetCommand({
        TableName: this.#tableName,
        Key: this.#key(owner, day),
        ConsistentRead: true,
      }),
    );
    return Item === undefined ? 0 : v.parse(itemSchema, Item).microUsd;
  }
}
// #endregion ledger
