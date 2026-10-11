import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import type { CacheEntry, CacheStore, CounterStore, IncrementResult, WindowRef } from "./stores.ts";

type Client = Pick<DynamoDBDocumentClient, "send">;

/** The table's TTL attribute: Unix seconds, as DynamoDB requires. */
export const TTL_ATTRIBUTE = "expiresAt";
const toTtl = (ms: number): number => Math.ceil(ms / 1000);

// Items are outside data: an item written by an older version must not pass as valid.
const counterItem = z.object({ hits: z.number().int().nonnegative() });
const cacheItem = z.object({ payload: z.string(), expiresAtMs: z.number() });

const isConditionFailure = (error: unknown): boolean => error instanceof ConditionalCheckFailedException;

export class DynamoDbCounterStore implements CounterStore {
  readonly #client: Client;
  readonly #tableName: string;

  constructor(client: Client, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  #key(window: Pick<WindowRef, "subject" | "windowStart">) {
    return { pk: `RATE#${window.subject}`, sk: `WINDOW#${window.windowStart}` };
  }

  // #region increment
  async incrementBelow(window: WindowRef, cap: number): Promise<IncrementResult> {
    try {
      const result = await this.#client.send(
        new UpdateCommand({
          TableName: this.#tableName,
          Key: this.#key(window),
          // ADD on a missing attribute sets it to the value, so the first request needs no special case.
          UpdateExpression: "ADD #hits :one SET #ttl = :ttl",
          // Checked and applied by DynamoDB as one step. Reading the count
          // first and writing count + 1 would lose increments under concurrency.
          ConditionExpression: "attribute_not_exists(#hits) OR #hits < :cap",
          ExpressionAttributeNames: { "#hits": "hits", "#ttl": TTL_ATTRIBUTE },
          ExpressionAttributeValues: { ":one": 1, ":cap": cap, ":ttl": toTtl(window.expiresAt) },
          ReturnValues: "UPDATED_NEW",
        }),
      );
      return { accepted: true, count: counterItem.parse(result.Attributes).hits };
    } catch (error) {
      if (isConditionFailure(error)) {
        return { accepted: false };
      }
      throw error;
    }
  }
  // #endregion increment

  async read(window: Pick<WindowRef, "subject" | "windowStart">): Promise<number> {
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.#tableName,
        Key: this.#key(window),
        // The window that just closed may have been written a moment ago.
        ConsistentRead: true,
      }),
    );
    return result.Item === undefined ? 0 : counterItem.parse(result.Item).hits;
  }
}

export class DynamoDbCacheStore implements CacheStore {
  readonly #client: Client;
  readonly #tableName: string;

  constructor(client: Client, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  // #region cache-get
  async get(key: string, now: number): Promise<string | undefined> {
    const result = await this.#client.send(
      new GetCommand({ TableName: this.#tableName, Key: { pk: `CACHE#${key}`, sk: "VALUE" } }),
    );
    const item = cacheItem.safeParse(result.Item);
    // TTL deletes expired items days later, not at the second they expire.
    // Until then GetItem returns them, so the check has to be made here.
    if (!item.success || item.data.expiresAtMs <= now) {
      return undefined;
    }
    return item.data.payload;
  }
  // #endregion cache-get

  async set(key: string, entry: CacheEntry): Promise<void> {
    await this.#client.send(
      new PutCommand({
        TableName: this.#tableName,
        Item: {
          pk: `CACHE#${key}`,
          sk: "VALUE",
          payload: entry.value,
          // Milliseconds for the read-side check, seconds for DynamoDB's cleanup.
          expiresAtMs: entry.expiresAt,
          [TTL_ATTRIBUTE]: toTtl(entry.expiresAt),
        },
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.#client.send(
      new DeleteCommand({ TableName: this.#tableName, Key: { pk: `CACHE#${key}`, sk: "VALUE" } }),
    );
  }

  // #region lock
  async tryLock(key: string, owner: string, expiresAt: number, now: number): Promise<boolean> {
    try {
      await this.#client.send(
        new PutCommand({
          TableName: this.#tableName,
          Item: { pk: `CACHE#${key}`, sk: "LOCK", owner, expiresAtMs: expiresAt, [TTL_ATTRIBUTE]: toTtl(expiresAt) },
          // An expired lock is still in the table, so "free" has to include "expired".
          ConditionExpression: "attribute_not_exists(pk) OR #expiresAtMs <= :now",
          ExpressionAttributeNames: { "#expiresAtMs": "expiresAtMs" },
          ExpressionAttributeValues: { ":now": now },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) {
        return false;
      }
      throw error;
    }
  }

  async unlock(key: string, owner: string): Promise<void> {
    try {
      await this.#client.send(
        new DeleteCommand({
          TableName: this.#tableName,
          Key: { pk: `CACHE#${key}`, sk: "LOCK" },
          // Ours may have expired and been taken by someone else since.
          ConditionExpression: "#owner = :owner",
          ExpressionAttributeNames: { "#owner": "owner" },
          ExpressionAttributeValues: { ":owner": owner },
        }),
      );
    } catch (error) {
      if (!isConditionFailure(error)) {
        throw error;
      }
    }
  }
  // #endregion lock
}
