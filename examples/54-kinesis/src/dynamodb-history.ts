import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { type DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import type { HistoryStore, NoteHistory } from "./history.ts";
import type { Revision } from "./revision.ts";

const itemSchema = v.object({
  noteId: v.string(),
  owner: v.string(),
  version: v.pipe(v.number(), v.safeInteger()),
  revisions: v.pipe(v.number(), v.safeInteger()),
  deleted: v.boolean(),
  updatedAt: v.string(),
});

export class DynamoDbHistoryStore implements HistoryStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #table: string;

  constructor(client: DynamoDBDocumentClient, table: string) {
    this.#client = client;
    this.#table = table;
  }

  // #region apply
  async apply(revision: Revision) {
    try {
      await this.#client.send(
        new UpdateCommand({
          ...this.#update(revision),
          // The whole guard. A second delivery finds its own version stored and changes nothing.
          ConditionExpression: "attribute_not_exists(noteId) OR #version < :version",
        }),
      );
      return "applied" as const;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return "stale" as const;
      }
      throw error;
    }
  }
  // #endregion apply

  async applyBlindly(revision: Revision) {
    await this.#client.send(new UpdateCommand(this.#update(revision)));
  }

  async get(noteId: string): Promise<NoteHistory | undefined> {
    const { Item } = await this.#client.send(
      new GetCommand({ TableName: this.#table, Key: { noteId }, ConsistentRead: true }),
    );
    return Item === undefined ? undefined : v.parse(itemSchema, Item);
  }

  #update(revision: Revision) {
    return {
      TableName: this.#table,
      Key: { noteId: revision.noteId },
      UpdateExpression:
        "SET #owner = :owner, #version = :version, #deleted = :deleted, #updatedAt = :at ADD #revisions :one",
      ExpressionAttributeNames: {
        "#owner": "owner",
        "#version": "version",
        "#deleted": "deleted",
        "#updatedAt": "updatedAt",
        "#revisions": "revisions",
      },
      ExpressionAttributeValues: {
        ":owner": revision.owner,
        ":version": revision.version,
        ":deleted": revision.kind === "deleted",
        ":at": revision.at,
        ":one": 1,
      },
    };
  }
}
