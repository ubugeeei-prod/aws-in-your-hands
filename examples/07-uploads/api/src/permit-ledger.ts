import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { type DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

// #region ledger
// A permit leaves nothing in the bucket until it is used, so the bucket cannot
// say how many are out. This count can: one number per owner and UTC day.
export type PermitLedger = {
  /** Counts one more permit. False, with nothing counted, once the day's allowance is used up. */
  take(owner: string, day: string, max: number): Promise<boolean>;
};

export const permitDay = (now: Date): string => now.toISOString().slice(0, 10);
// #endregion ledger

export class InMemoryPermitLedger implements PermitLedger {
  readonly #issued = new Map<string, number>();

  async take(owner: string, day: string, max: number) {
    const key = `${owner}/${day}`;
    const issued = this.#issued.get(key) ?? 0;
    if (issued >= max) {
      return false;
    }
    this.#issued.set(key, issued + 1);
    return true;
  }
}

// #region dynamodb
// The notes table again: the owner's partition, under a sort key no list asks for.
export class DynamoDbPermitLedger implements PermitLedger {
  readonly #client: Pick<DynamoDBDocumentClient, "send">;
  readonly #tableName: string;

  constructor(client: Pick<DynamoDBDocumentClient, "send">, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  async take(owner: string, day: string, max: number) {
    try {
      await this.#client.send(
        new UpdateCommand({
          TableName: this.#tableName,
          Key: { pk: `OWNER#${owner}`, sk: `PERMITS#${day}` },
          UpdateExpression: "ADD issued :one",
          // Checked and counted as one step, so requests side by side cannot both take the last one.
          ConditionExpression: "attribute_not_exists(issued) OR issued < :max",
          ExpressionAttributeValues: { ":one": 1, ":max": max },
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
}
// #endregion dynamodb
