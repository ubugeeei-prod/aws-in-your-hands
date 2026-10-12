import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { type Note, noteSchema } from "./contract.ts";
import { decodeCursor, encodeCursor, type NoteRepository } from "./repository.ts";

// #region keys
// The partition key groups an owner's notes; the sort key orders them.
// Note IDs sort by creation time, so key order is creation order.
const pk = (owner: string): string => `OWNER#${owner}`;
const sk = (noteId: string): string => `NOTE#${noteId}`;
// #endregion keys

// One item per owner counts that owner's notes. No `NOTE#` prefix, so a list never returns it.
const QUOTA = "QUOTA";

// Stored items are outside data too: an old or hand-edited item must not pass as a `Note`.
const itemSchema = noteSchema.extend({ pk: z.string(), sk: z.string() });

function toNote(item: unknown): Note {
  const { pk: _pk, sk: _sk, ...note } = itemSchema.parse(item);
  return note;
}

export class DynamoDbNoteRepository implements NoteRepository {
  readonly #client: Pick<DynamoDBDocumentClient, "send">;
  readonly #tableName: string;
  readonly #maxNotesPerOwner: number | undefined;

  /** Without `maxNotesPerOwner`, notes are not counted and no quota item is written. */
  constructor(
    client: Pick<DynamoDBDocumentClient, "send">,
    tableName: string,
    maxNotesPerOwner?: number,
  ) {
    this.#client = client;
    this.#tableName = tableName;
    this.#maxNotesPerOwner = maxNotesPerOwner;
  }

  // #region quota
  /** Takes one of the owner's places. False when none is left. */
  async #reserve(owner: string, max: number): Promise<boolean> {
    try {
      await this.#client.send(
        new UpdateCommand({
          TableName: this.#tableName,
          Key: { pk: pk(owner), sk: QUOTA },
          UpdateExpression: "ADD noteCount :one",
          // Checked and counted as a single step, so two creates cannot both
          // take the last place. Counting the notes first would let both pass.
          ConditionExpression: "attribute_not_exists(noteCount) OR noteCount < :max",
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

  async #release(owner: string): Promise<void> {
    try {
      await this.#client.send(
        new UpdateCommand({
          TableName: this.#tableName,
          Key: { pk: pk(owner), sk: QUOTA },
          UpdateExpression: "ADD noteCount :minusOne",
          ConditionExpression: "noteCount > :zero",
          ExpressionAttributeValues: { ":minusOne": -1, ":zero": 0 },
        }),
      );
    } catch (error) {
      // A note written before the limit existed took no place. Nothing to give back.
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }
    }
  }
  // #endregion quota

  // #region create
  async create(owner: string, note: Note) {
    const max = this.#maxNotesPerOwner;
    // The place is taken before the note is written, as two separate requests.
    // If this stops in between, the count stays one too high: never too low.
    if (max !== undefined && !(await this.#reserve(owner, max))) {
      return "quota_exceeded" as const;
    }
    try {
      await this.#client.send(
        new PutCommand({
          TableName: this.#tableName,
          Item: { pk: pk(owner), sk: sk(note.id), ...note },
          // Without this, PutItem silently replaces an item with the same key.
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return "created" as const;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        // Certain that nothing was written. Any other failure keeps the place:
        // the write may have landed.
        if (max !== undefined) {
          await this.#release(owner);
        }
        return "already_exists" as const;
      }
      throw error;
    }
  }
  // #endregion create

  // #region get
  async get(owner: string, id: string) {
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.#tableName,
        Key: { pk: pk(owner), sk: sk(id) },
        // A caller reading back what it just saved must see it. Costs twice
        // an eventually consistent read.
        ConsistentRead: true,
      }),
    );
    return result.Item === undefined ? undefined : toNote(result.Item);
  }
  // #endregion get

  // #region list
  async list(owner: string, options: { limit: number; cursor?: string | undefined }) {
    const after = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
    const result = await this.#client.send(
      new QueryCommand({
        TableName: this.#tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :note)",
        ExpressionAttributeValues: { ":pk": pk(owner), ":note": "NOTE#" },
        ScanIndexForward: false,
        Limit: options.limit,
        ...(after === undefined ? {} : { ExclusiveStartKey: { pk: pk(owner), sk: sk(after) } }),
        // Eventually consistent (the default): half the price. A note saved an
        // instant ago can be missing from the next list.
      }),
    );
    const notes = (result.Items ?? []).map(toNote);
    const last = notes.at(-1);
    // LastEvaluatedKey is the only reliable sign that the query stopped early.
    // It can be present on the final page; the next page is then empty.
    return {
      notes,
      nextCursor:
        result.LastEvaluatedKey !== undefined && last !== undefined ? encodeCursor(last.id) : null,
    };
  }
  // #endregion list

  // #region update
  async update(
    owner: string,
    id: string,
    change: { title: string; body: string; expectedVersion: number; updatedAt: string },
  ) {
    try {
      const result = await this.#client.send(
        new UpdateCommand({
          TableName: this.#tableName,
          Key: { pk: pk(owner), sk: sk(id) },
          UpdateExpression:
            "SET title = :title, body = :body, updatedAt = :updatedAt, version = :next",
          // The whole optimistic lock: checked and applied as a single step, so
          // two writers holding the same version cannot both pass. A missing item fails too.
          ConditionExpression: "version = :expected",
          ExpressionAttributeValues: {
            ":title": change.title,
            ":body": change.body,
            ":updatedAt": change.updatedAt,
            ":expected": change.expectedVersion,
            ":next": change.expectedVersion + 1,
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      return { status: "updated" as const, note: toNote(result.Attributes) };
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }
      // Gone, or version moved on? This read tells which. It is a separate
      // step: the note can change again before the caller sees the answer.
      const current = await this.get(owner, id);
      return current === undefined
        ? { status: "not_found" as const }
        : { status: "conflict" as const, current };
    }
  }
  // #endregion update

  async delete(owner: string, id: string) {
    const result = await this.#client.send(
      new DeleteCommand({
        TableName: this.#tableName,
        Key: { pk: pk(owner), sk: sk(id) },
        ReturnValues: "ALL_OLD",
      }),
    );
    const deleted = result.Attributes !== undefined;
    // ALL_OLD answers for one caller only, so one delete gives back one place.
    if (deleted && this.#maxNotesPerOwner !== undefined) {
      await this.#release(owner);
    }
    return deleted;
  }
}
