import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { type DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { noteKey, ownerKey, type TableItem, type TableReader } from "./items.ts";
import type { NoteVersionStore } from "./table-diff.ts";

export class DynamoDbTable implements TableReader, NoteVersionStore {
  readonly #client: Pick<DynamoDBDocumentClient, "send">;
  readonly #tableName: string;

  constructor(client: Pick<DynamoDBDocumentClient, "send">, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  // #region scan
  // The one place in this book that reads a whole table. A check that must
  // see every item has no cheaper way; the price is every item, every run.
  async *scan(): AsyncIterable<TableItem> {
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.#client.send(
        new ScanCommand({ TableName: this.#tableName, ConsistentRead: true, ExclusiveStartKey: startKey }),
      );
      yield* page.Items ?? [];
      startKey = page.LastEvaluatedKey;
    } while (startKey !== undefined);
  }
  // #endregion scan

  // #region raise-version
  async raiseVersion(owner: string, id: string, to: number) {
    try {
      await this.#client.send(
        new UpdateCommand({
          TableName: this.#tableName,
          Key: { pk: ownerKey(owner), sk: noteKey(id) },
          UpdateExpression: "SET version = :to",
          // Only ever upwards, and only on a note that exists. A second run changes nothing.
          ConditionExpression: "attribute_exists(pk) AND version < :to",
          ExpressionAttributeValues: { ":to": to },
        }),
      );
      return "raised" as const;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return "unchanged" as const;
      }
      throw error;
    }
  }
  // #endregion raise-version
}
