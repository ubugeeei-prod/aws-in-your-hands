import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { type DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { NotificationState } from "./contract.ts";
import {
  type Advance,
  allowedFrom,
  type Claim,
  type ClaimResult,
  normalizeAddress,
  type NotificationRecord,
  notificationRecordSchema,
  type NotificationStore,
  type Suppression,
  suppressionSchema,
} from "./store.ts";

const notificationKey = (notificationId: string) => ({ pk: `NOTIFICATION#${notificationId}` });
const suppressionKey = (address: string) => ({ pk: `SUPPRESSION#${normalizeAddress(address)}` });

export class DynamoDbNotificationStore implements NotificationStore {
  readonly #client: Pick<DynamoDBDocumentClient, "send">;
  readonly #tableName: string;

  constructor(client: Pick<DynamoDBDocumentClient, "send">, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  // #region claim
  async claim(claim: Claim): Promise<ClaimResult> {
    const record: NotificationRecord = {
      notificationId: claim.notificationId,
      to: claim.to,
      fingerprint: claim.fingerprint,
      state: "claimed",
      claimedAt: claim.at,
      updatedAt: claim.at,
      expiresAt: claim.expiresAt,
    };
    try {
      await this.#client.send(
        new PutCommand({
          TableName: this.#tableName,
          Item: { ...notificationKey(claim.notificationId), ...record },
          // Checked and written as one step: of two requests arriving together, one passes.
          ConditionExpression: "attribute_not_exists(pk) OR (#state = :rejected AND fingerprint = :fingerprint)",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: { ":rejected": "rejected", ":fingerprint": claim.fingerprint },
        }),
      );
      return { claimed: true };
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }
      const existing = await this.get(claim.notificationId);
      if (existing === undefined) {
        // Expired between the two calls. The caller's retry starts clean.
        throw new Error(`notification ${claim.notificationId} disappeared while it was being claimed`, {
          cause: error,
        });
      }
      return { claimed: false, existing };
    }
  }
  // #endregion claim

  // #region advance
  async advance(notificationId: string, next: Exclude<NotificationState, "claimed">, change: Advance) {
    const from = Object.fromEntries(allowedFrom[next].map((state, index) => [`:from${index}`, state]));
    try {
      await this.#client.send(
        new UpdateCommand({
          TableName: this.#tableName,
          Key: notificationKey(notificationId),
          UpdateExpression: `SET #state = :next, updatedAt = :at${change.messageId === undefined ? "" : ", messageId = :messageId"}`,
          // Also false for a missing item, so an event for an unknown notification creates nothing.
          ConditionExpression: `#state IN (${Object.keys(from).join(", ")})`,
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":next": next,
            ":at": change.at,
            ...from,
            ...(change.messageId === undefined ? {} : { ":messageId": change.messageId }),
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
  // #endregion advance

  async get(notificationId: string) {
    const result = await this.#client.send(
      new GetCommand({ TableName: this.#tableName, Key: notificationKey(notificationId), ConsistentRead: true }),
    );
    // A stored item is outside data too.
    return result.Item === undefined ? undefined : notificationRecordSchema.parse(result.Item);
  }

  async findSuppression(address: string) {
    const result = await this.#client.send(
      // Eventually consistent: a bounce from a moment ago may not show yet. SES's own list covers that gap.
      new GetCommand({ TableName: this.#tableName, Key: suppressionKey(address) }),
    );
    return result.Item === undefined ? undefined : suppressionSchema.parse(result.Item);
  }

  async suppress(suppression: Suppression) {
    const address = normalizeAddress(suppression.address);
    await this.#client.send(
      new PutCommand({
        TableName: this.#tableName,
        // No expiresAt: a suppression stays until someone removes it.
        Item: { ...suppressionKey(address), ...suppression, address },
      }),
    );
  }
}
