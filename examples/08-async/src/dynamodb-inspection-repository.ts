import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, type DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { type Inspection, type InspectionRepository, inspectionSchema } from "./inspection.ts";

// #region keys
// The owner's partition again (chapters 05 and 07), under a third sort key
// prefix. Neither the note list nor the attachment list sees these.
const pk = (owner: string): string => `OWNER#${owner}`;
const sk = (noteId: string, attachmentId: string): string => `INSPECTION#${noteId}#${attachmentId}`;
// #endregion keys

const itemSchema = inspectionSchema.extend({ pk: z.string(), sk: z.string() });

export class DynamoDbInspectionRepository implements InspectionRepository {
  readonly #client: Pick<DynamoDBDocumentClient, "send">;
  readonly #tableName: string;

  constructor(client: Pick<DynamoDBDocumentClient, "send">, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  // #region put-if-newer
  async putIfNewer(owner: string, inspection: Inspection) {
    // Optional fields are left out, not written as undefined.
    const item = Object.fromEntries(Object.entries(inspection).filter(([, value]) => value !== undefined));
    try {
      await this.#client.send(
        new PutCommand({
          TableName: this.#tableName,
          Item: { pk: pk(owner), sk: sk(inspection.noteId, inspection.attachmentId), ...item },
          // DynamoDB checks and writes in one step. Two workers holding the
          // same event cannot both pass, and an older event cannot overwrite a newer one.
          ConditionExpression: "attribute_not_exists(pk) OR sequencer < :sequencer",
          ExpressionAttributeValues: { ":sequencer": inspection.sequencer },
        }),
      );
      return "written" as const;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return "not_newer" as const;
      }
      throw error;
    }
  }
  // #endregion put-if-newer

  async deleteIfOlder(owner: string, noteId: string, attachmentId: string, sequencer: string) {
    try {
      await this.#client.send(
        new DeleteCommand({
          TableName: this.#tableName,
          Key: { pk: pk(owner), sk: sk(noteId, attachmentId) },
          ConditionExpression: "attribute_not_exists(pk) OR sequencer < :sequencer",
          ExpressionAttributeValues: { ":sequencer": sequencer },
        }),
      );
      return "deleted" as const;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return "kept" as const;
      }
      throw error;
    }
  }

  async get(owner: string, noteId: string, attachmentId: string) {
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.#tableName,
        Key: { pk: pk(owner), sk: sk(noteId, attachmentId) },
        ConsistentRead: true,
      }),
    );
    if (result.Item === undefined) {
      return undefined;
    }
    const { pk: _pk, sk: _sk, ...inspection } = itemSchema.parse(result.Item);
    return inspection;
  }
}
