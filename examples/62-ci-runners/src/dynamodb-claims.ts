import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type { Claims } from "./claims.ts";

type Timing = { leaseSeconds: number; retentionSeconds: number };

// #region claims
export function dynamoDbClaims(
  client: Pick<DynamoDBDocumentClient, "send">,
  tableName: string,
  timing: Timing,
): Claims {
  return {
    async claim(key, now) {
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              pk: key,
              state: "launching",
              leaseUntil: now + timing.leaseSeconds,
              expiresAt: now + timing.retentionSeconds,
            },
            // Checked and written in one step: two receivers holding the same delivery cannot both pass.
            ConditionExpression:
              "attribute_not_exists(pk) OR (#state = :launching AND leaseUntil < :now)",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: { ":launching": "launching", ":now": now },
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
    async complete(key, taskArn, now) {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: key },
          UpdateExpression: "SET #state = :launched, taskArn = :task, expiresAt = :expires",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":launched": "launched",
            ":task": taskArn,
            ":expires": now + timing.retentionSeconds,
          },
        }),
      );
    },
    async release(key) {
      await client.send(new DeleteCommand({ TableName: tableName, Key: { pk: key } }));
    },
  };
}
// #endregion claims
