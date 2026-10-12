import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import type { CounterStore } from "./counter.ts";
import { type TimelineEntry, timelineEntrySchema, type TimelineStore } from "./timeline.ts";

type Client = Pick<DynamoDBDocumentClient, "send">;

// A table of its own, written only by the consumers. The owner's partition
// again, so everything derived for one user sits together.
const pk = (owner: string): string => `OWNER#${owner}`;
const COUNT = "COUNT";

// #region timeline-store
export class DynamoDbTimelineStore implements TimelineStore {
  readonly #client: Client;
  readonly #tableName: string;

  constructor(client: Client, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  async putIfNewer(owner: string, entry: TimelineEntry) {
    try {
      await this.#client.send(
        new PutCommand({
          TableName: this.#tableName,
          Item: { pk: pk(owner), sk: `TIMELINE#${entry.noteId}`, ...entry },
          // The same event again has the same rank and is refused; so is an older one arriving late.
          ConditionExpression: "attribute_not_exists(pk) OR #rank < :rank",
          ExpressionAttributeNames: { "#rank": "rank" },
          ExpressionAttributeValues: { ":rank": entry.rank },
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

  async get(owner: string, noteId: string) {
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.#tableName,
        Key: { pk: pk(owner), sk: `TIMELINE#${noteId}` },
        ConsistentRead: true,
      }),
    );
    return result.Item === undefined ? undefined : v.parse(timelineEntrySchema, result.Item);
  }
}
// #endregion timeline-store

// #region counter-store
export class DynamoDbCounterStore implements CounterStore {
  readonly #client: Client;
  readonly #tableName: string;
  readonly #markerSeconds: number;
  readonly #now: () => Date;

  constructor(client: Client, tableName: string, markerDays: number, now: () => Date) {
    this.#client = client;
    this.#tableName = tableName;
    this.#markerSeconds = markerDays * 24 * 60 * 60;
    this.#now = now;
  }

  async add(owner: string, delta: number) {
    await this.#client.send(new UpdateCommand(this.#update(owner, delta).Update));
  }

  async addOnce(owner: string, eventId: string, delta: number) {
    try {
      await this.#client.send(
        new TransactWriteCommand({
          // Both writes happen or neither does. A marker without its addition
          // would lose a note; an addition without its marker would count it twice.
          TransactItems: [
            {
              Put: {
                TableName: this.#tableName,
                Item: {
                  pk: pk(owner),
                  sk: `COUNTED#${eventId}`,
                  // The table's TTL attribute: DynamoDB deletes the marker some time after this.
                  expiresAt: Math.floor(this.#now().getTime() / 1000) + this.#markerSeconds,
                },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            this.#update(owner, delta),
          ],
        }),
      );
      return "counted" as const;
    } catch (error) {
      // The first item is the marker. Refused there: this event was counted before.
      if (
        error instanceof TransactionCanceledException &&
        error.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed"
      ) {
        return "already_counted" as const;
      }
      throw error;
    }
  }

  async get(owner: string) {
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.#tableName,
        Key: { pk: pk(owner), sk: COUNT },
        ConsistentRead: true,
      }),
    );
    return v.parse(v.object({ noteCount: v.optional(v.number(), 0) }), result.Item ?? {}).noteCount;
  }

  #update(owner: string, delta: number) {
    return {
      Update: {
        TableName: this.#tableName,
        Key: { pk: pk(owner), sk: COUNT },
        UpdateExpression: "ADD noteCount :delta",
        ExpressionAttributeValues: { ":delta": delta },
      },
    };
  }
}
// #endregion counter-store
