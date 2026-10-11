import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import type { AttachmentRepository } from "./attachment-repository.ts";
import { type Attachment, attachmentSchema } from "./contract.ts";

// #region keys
// Same table and same partition as the owner's notes (chapter 05), under a
// different sort key prefix. The note list asks for `NOTE#...` and never sees these.
const pk = (owner: string): string => `OWNER#${owner}`;
const sk = (noteId: string, id: string): string => `ATTACHMENT#${noteId}#${id}`;
// #endregion keys

const itemSchema = attachmentSchema.extend({ pk: z.string(), sk: z.string() });

function toAttachment(item: unknown): Attachment {
  const { pk: _pk, sk: _sk, ...attachment } = itemSchema.parse(item);
  return attachment;
}

export class DynamoDbAttachmentRepository implements AttachmentRepository {
  readonly #client: Pick<DynamoDBDocumentClient, "send">;
  readonly #tableName: string;

  constructor(client: Pick<DynamoDBDocumentClient, "send">, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  async create(owner: string, attachment: Attachment) {
    try {
      await this.#client.send(
        new PutCommand({
          TableName: this.#tableName,
          Item: { pk: pk(owner), sk: sk(attachment.noteId, attachment.id), ...attachment },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return "created" as const;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return "already_exists" as const;
      }
      throw error;
    }
  }

  async get(owner: string, noteId: string, id: string) {
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.#tableName,
        Key: { pk: pk(owner), sk: sk(noteId, id) },
        // "Is this upload already recorded?" must not be answered from a stale copy.
        ConsistentRead: true,
      }),
    );
    return result.Item === undefined ? undefined : toAttachment(result.Item);
  }

  async listByNote(owner: string, noteId: string) {
    const attachments: Attachment[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.#client.send(
        new QueryCommand({
          TableName: this.#tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":pk": pk(owner), ":prefix": sk(noteId, "") },
          // Strongly consistent: the count behind the per-note limit, and the
          // list a browser reads right after it attached an image.
          ConsistentRead: true,
          ExclusiveStartKey: startKey,
        }),
      );
      attachments.push(...(result.Items ?? []).map(toAttachment));
      startKey = result.LastEvaluatedKey;
    } while (startKey !== undefined);
    return attachments;
  }

  async delete(owner: string, noteId: string, id: string) {
    const result = await this.#client.send(
      new DeleteCommand({
        TableName: this.#tableName,
        Key: { pk: pk(owner), sk: sk(noteId, id) },
        ReturnValues: "ALL_OLD",
      }),
    );
    return result.Attributes !== undefined;
  }
}
