import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  type UpdateCommandInput,
} from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { subSchema } from "./contract.ts";
import type { Room, RoomStore, SeatChange } from "./room-store.ts";

// #region keys
// The notes table of chapter 05, in a partition of its own per room. A note list asks for
// `OWNER#...` and never sees these.
const key = (id: string) => ({ pk: `ROOM#${id}`, sk: "ROOM" });
// #endregion keys

const itemSchema = v.object({
  id: v.string(),
  owner: subSchema,
  // A DynamoDB string set arrives as a Set.
  members: v.pipe(
    v.instance(Set),
    v.transform((set) => [...set]),
    v.array(subSchema),
  ),
  closed: v.boolean(),
  meetingId: v.optional(v.string()),
  seats: v.record(v.string(), v.string()),
});

export class DynamoDbRoomStore implements RoomStore {
  readonly #client: Pick<DynamoDBDocumentClient, "send">;
  readonly #tableName: string;

  constructor(client: Pick<DynamoDBDocumentClient, "send">, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  /** True when the write happened, false when its condition did not hold. */
  async #update(id: string, input: Omit<UpdateCommandInput, "TableName" | "Key">) {
    try {
      await this.#client.send(
        new UpdateCommand({ TableName: this.#tableName, Key: key(id), ...input }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }
      throw error;
    }
  }

  async create(room: Room) {
    await this.#client.send(
      new PutCommand({
        TableName: this.#tableName,
        Item: { ...key(room.id), ...room, members: new Set(room.members) },
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
  }

  async get(id: string) {
    const result = await this.#client.send(
      // "May this user sit here?" must not be answered from a stale copy.
      new GetCommand({ TableName: this.#tableName, Key: key(id), ConsistentRead: true }),
    );
    return result.Item === undefined ? undefined : v.parse(itemSchema, result.Item);
  }

  addMember(id: string, sub: string, max: number) {
    return this.#update(id, {
      UpdateExpression: "ADD members :one",
      ConditionExpression:
        "attribute_exists(pk) AND closed = :open AND (contains(members, :sub) OR size(members) < :max)",
      ExpressionAttributeValues: {
        ":one": new Set([sub]),
        ":sub": sub,
        ":open": false,
        ":max": max,
      },
    });
  }

  async removeMember(id: string, sub: string) {
    await this.#update(id, {
      UpdateExpression: "DELETE members :one",
      ConditionExpression: "attribute_exists(pk)",
      ExpressionAttributeValues: { ":one": new Set([sub]) },
    });
  }

  // #region conditions
  setMeeting(id: string, expected: string | undefined, next: string | undefined) {
    const unchanged =
      expected === undefined ? "attribute_not_exists(meetingId)" : "meetingId = :expected";
    return this.#update(id, {
      UpdateExpression:
        next === undefined
          ? "REMOVE meetingId SET seats = :none"
          : "SET meetingId = :next, seats = :none",
      ConditionExpression: `attribute_exists(pk) AND ${unchanged}${next === undefined ? "" : " AND closed = :open"}`,
      ExpressionAttributeValues: {
        ":none": {},
        ...(expected === undefined ? {} : { ":expected": expected }),
        ...(next === undefined ? {} : { ":next": next, ":open": false }),
      },
    });
  }

  setSeat(id: string, { meetingId, sub, expected, next }: SeatChange) {
    const unchanged =
      expected === undefined ? "attribute_not_exists(seats.#sub)" : "seats.#sub = :expected";
    return this.#update(id, {
      UpdateExpression: next === undefined ? "REMOVE seats.#sub" : "SET seats.#sub = :next",
      // Giving up a seat needs no membership: that is how a removed member's seat is cleared.
      ConditionExpression: `meetingId = :meeting AND ${unchanged}${
        next === undefined ? "" : " AND closed = :open AND contains(members, :sub)"
      }`,
      ExpressionAttributeNames: { "#sub": sub },
      ExpressionAttributeValues: {
        ":meeting": meetingId,
        ...(expected === undefined ? {} : { ":expected": expected }),
        ...(next === undefined ? {} : { ":next": next, ":open": false, ":sub": sub }),
      },
    });
  }
  // #endregion conditions

  async close(id: string) {
    await this.#update(id, {
      UpdateExpression: "SET closed = :closed",
      ConditionExpression: "attribute_exists(pk)",
      ExpressionAttributeValues: { ":closed": true },
    });
  }

  async delete(id: string) {
    await this.#client.send(new DeleteCommand({ TableName: this.#tableName, Key: key(id) }));
  }
}
