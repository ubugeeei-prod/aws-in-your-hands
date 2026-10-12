import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { type DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { STATUSES } from "./event.ts";
import type { Entry, Ledger } from "./ledger.ts";

// An unresolved planned change stays open for years; an entry that expires in between
// only means the next real change is announced as new.
export const KEEP_DAYS = 180;

const itemSchema = v.object({
  revision: v.string(),
  clock: v.pipe(v.number(), v.finite()),
  status: v.picklist(STATUSES),
  notified: v.boolean(),
  claimedAt: v.pipe(v.number(), v.finite()),
  writes: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
});

// #region ledger
export function dynamodbLedger(client: DynamoDBDocumentClient, tableName: string): Ledger {
  return {
    async read(key) {
      const { Item } = await client.send(
        // The decision is made on this read, so it must not be a stale one.
        new GetCommand({ TableName: tableName, Key: { pk: key }, ConsistentRead: true }),
      );
      return Item === undefined ? undefined : v.parse(itemSchema, Item);
    },
    async write(key, next: Entry, previous) {
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              pk: key,
              ...next,
              expiresAt: Math.floor(next.claimedAt / 1000) + KEEP_DAYS * 86_400,
            },
            ...(previous === undefined
              ? { ConditionExpression: "attribute_not_exists(pk)" }
              : {
                  ConditionExpression: "writes = :writes",
                  ExpressionAttributeValues: { ":writes": previous.writes },
                }),
          }),
        );
        return true;
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          return false;
        }
        throw error;
      }
    },
  };
}
// #endregion ledger
