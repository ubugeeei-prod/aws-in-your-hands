import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  type DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { type Command, commandKeyOf } from "./command.ts";
import { type ApplyResult, type Ledger, MAX_LINES, type NoteState } from "./ledger.ts";

const noteSchema = v.object({
  title: v.optional(v.string(), ""),
  lines: v.optional(v.array(v.string()), []),
  applied: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
});

type Update = NonNullable<
  NonNullable<TransactWriteCommandInput["TransactItems"]>[number]["Update"]
>;

const notePk = (owner: string, noteId: string): string => `NOTE#${owner}/${noteId}`;

export class DynamoDbLedger implements Ledger {
  readonly #client: Pick<DynamoDBDocumentClient, "send">;
  readonly #tableName: string;
  readonly #markerSeconds: number;
  readonly #now: () => Date;

  constructor(
    client: Pick<DynamoDBDocumentClient, "send">,
    tableName: string,
    markerDays: number,
    now: () => Date,
  ) {
    this.#client = client;
    this.#tableName = tableName;
    this.#markerSeconds = markerDays * 24 * 60 * 60;
    this.#now = now;
  }

  // #region apply
  async apply(command: Command): Promise<ApplyResult> {
    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.#tableName,
                Item: {
                  pk: `COMMAND#${commandKeyOf(command)}`,
                  // The table's TTL attribute, in seconds.
                  expiresAt: Math.floor(this.#now().getTime() / 1000) + this.#markerSeconds,
                },
                // The marker is the memory: this command, never before.
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            { Update: this.#update(command) },
          ],
        }),
      );
      return "applied";
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        // One reason per item, in the order the items were sent.
        const [marker, note] = error.CancellationReasons ?? [];
        if (marker?.Code === "ConditionalCheckFailed") {
          return "already_applied";
        }
        if (note?.Code === "ConditionalCheckFailed") {
          return "refused";
        }
      }
      throw error;
    }
  }

  #update(command: Command): Update {
    const base = {
      TableName: this.#tableName,
      Key: { pk: notePk(command.owner, command.noteId) },
    };
    if (command.change.type === "retitle") {
      return {
        ...base,
        UpdateExpression: "SET #title = :title ADD #applied :one",
        ExpressionAttributeNames: { "#title": "title", "#applied": "applied" },
        ExpressionAttributeValues: { ":title": command.change.title, ":one": 1 },
      };
    }
    return {
      ...base,
      // No read first: the list grows where it is, so two workers cannot overwrite each other.
      UpdateExpression:
        "SET #lines = list_append(if_not_exists(#lines, :none), :line) ADD #applied :one",
      ConditionExpression: "attribute_not_exists(#lines) OR size(#lines) < :max",
      ExpressionAttributeNames: { "#lines": "lines", "#applied": "applied" },
      ExpressionAttributeValues: {
        ":line": [command.change.line],
        ":none": [],
        ":one": 1,
        ":max": MAX_LINES,
      },
    };
  }
  // #endregion apply

  async get(owner: string, noteId: string): Promise<NoteState | undefined> {
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.#tableName,
        Key: { pk: notePk(owner, noteId) },
        ConsistentRead: true,
      }),
    );
    return result.Item === undefined ? undefined : v.parse(noteSchema, result.Item);
  }
}
