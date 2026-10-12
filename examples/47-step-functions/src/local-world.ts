// Stand-ins for the API calls the two definitions make, kept in memory. They
// implement what this chapter relies on, stated here, and nothing else of the services.

import * as v from "valibot";

import { TaskError, type World } from "./interpreter.ts";
import {
  ABSENT_OR_MINE_WHILE_PENDING,
  MINE,
  type ScanRequest,
  scanRequestSchema,
  type ScanVerdict,
} from "./saga.ts";

const attribute = v.union([v.strictObject({ S: v.string() }), v.strictObject({ N: v.string() })]);
type Attribute = v.InferOutput<typeof attribute>;
export type Item = Record<string, Attribute>;
const item = v.record(v.string(), attribute);
const names = v.optional(v.record(v.string(), v.string()), {});
const values = v.optional(item, {});
const keyed = { TableName: v.string(), Key: v.strictObject({ pk: attribute, sk: attribute }) };
const conditional = {
  ConditionExpression: v.string(),
  ExpressionAttributeNames: names,
  ExpressionAttributeValues: values,
};

const putItem = v.strictObject({ TableName: v.string(), Item: item, ...conditional });
const updateItem = v.strictObject({ ...keyed, UpdateExpression: v.string(), ...conditional });
const deleteItem = v.strictObject({ ...keyed, ...conditional });
const getItem = v.strictObject({
  ...keyed,
  ProjectionExpression: v.string(),
  ExpressionAttributeNames: names,
});
const copyObject = v.strictObject({ Bucket: v.string(), CopySource: v.string(), Key: v.string() });
const deleteObject = v.strictObject({ Bucket: v.string(), Key: v.string() });
const sendMessage = v.strictObject({ QueueUrl: v.string(), MessageBody: scanRequestSchema });
const publish = v.strictObject({
  TopicArn: v.string(),
  Message: v.string(),
  MessageAttributes: v.strictObject({
    saga: v.strictObject({ DataType: v.literal("String"), StringValue: v.string() }),
  }),
});

// #region conditions
// The table does not parse condition expressions. It knows the two the saga uses.
const CONDITIONS: Record<string, (stored: Item | undefined, bound: Item) => boolean> = {
  [ABSENT_OR_MINE_WHILE_PENDING]: (stored, bound) =>
    stored === undefined ||
    (same(stored["saga"], bound[":saga"]) && same(stored["phase"], bound[":pending"])),
  [MINE]: (stored, bound) => stored !== undefined && same(stored["saga"], bound[":saga"]),
};
const same = (a: Attribute | undefined, b: Attribute | undefined): boolean =>
  a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);
// #endregion conditions

export type Fault = {
  /** The state whose call fails. */
  state: string;
  error: string;
  /** How many calls in a row fail. */
  times: number;
  /** "lost": the call does its work, and the answer never arrives. */
  kind: "refused" | "lost";
};

// #region world
export class LocalWorld implements World {
  readonly items = new Map<string, Item>();
  readonly objects = new Map<string, string>();
  readonly scanRequests: ScanRequest[] = [];
  readonly notices: { message: string; saga: string }[] = [];
  readonly calls: { state: string; resource: string }[] = [];
  /** Plays the scanner: what it answers to the request with this token, or the error it reports. */
  scanner: (request: ScanRequest, delivery: number) => ScanVerdict = () => ({ verdict: "clean" });
  #faults: Fault[] = [];

  fail(fault: Fault): void {
    this.#faults.push({ ...fault });
  }

  /** Whatever was wrong has been fixed. */
  heal(): void {
    this.#faults = [];
  }

  async call(resource: string, args: unknown, at: { state: string }): Promise<unknown> {
    this.calls.push({ state: at.state, resource });
    const fault = this.#faults.find((item) => item.state === at.state && item.times > 0);
    if (fault?.kind === "refused") {
      fault.times--;
      throw new TaskError(fault.error, `injected: ${at.state} was refused`);
    }
    const result = this.#apply(resource, args);
    if (fault?.kind === "lost") {
      fault.times--;
      throw new TaskError(fault.error, `injected: the answer of ${at.state} was lost`);
    }
    return result;
  }

  async callback(token: string): Promise<unknown> {
    const delivery = this.scanRequests.findIndex((request) => request.taskToken === token);
    const request = this.scanRequests[delivery];
    if (request === undefined) {
      throw new Error(`no scan request carries ${token}`);
    }
    return this.scanner(request, delivery + 1);
  }
  // #endregion world

  // #region apply
  #apply(resource: string, args: unknown): unknown {
    switch (resource) {
      case "arn:aws:states:::dynamodb:putItem": {
        const input = v.parse(putItem, args);
        const key = keyOf(input.Item);
        this.#check(input, this.items.get(key));
        this.items.set(key, input.Item);
        return {};
      }
      case "arn:aws:states:::dynamodb:updateItem": {
        const input = v.parse(updateItem, args);
        const key = keyOf(input.Key);
        const stored = this.items.get(key);
        this.#check(input, stored);
        this.items.set(key, { ...stored, ...input.Key, ...assignments(input) });
        return {};
      }
      case "arn:aws:states:::dynamodb:deleteItem": {
        const input = v.parse(deleteItem, args);
        this.#check(input, this.items.get(keyOf(input.Key)));
        this.items.delete(keyOf(input.Key));
        return {};
      }
      case "arn:aws:states:::dynamodb:getItem": {
        const input = v.parse(getItem, args);
        const stored = this.items.get(keyOf(input.Key));
        if (stored === undefined) {
          return {};
        }
        const wanted = input.ProjectionExpression.split(",").map(
          (name) => input.ExpressionAttributeNames[name.trim()] ?? name.trim(),
        );
        return {
          Item: Object.fromEntries(
            Object.entries(stored).filter(([name]) => wanted.includes(name)),
          ),
        };
      }
      case "arn:aws:states:::aws-sdk:s3:copyObject": {
        const input = v.parse(copyObject, args);
        const source = this.objects.get(input.CopySource.slice(input.Bucket.length + 1));
        if (!input.CopySource.startsWith(`${input.Bucket}/`) || source === undefined) {
          // The name follows the documented rule for SDK integrations: service, error code, "Exception".
          throw new TaskError("S3.NoSuchKeyException", `${input.CopySource} does not exist`);
        }
        this.objects.set(input.Key, source);
        return {};
      }
      case "arn:aws:states:::aws-sdk:s3:deleteObject": {
        // Deleting a key that is not there succeeds, as in an unversioned bucket.
        this.objects.delete(v.parse(deleteObject, args).Key);
        return {};
      }
      case "arn:aws:states:::sqs:sendMessage": {
        this.scanRequests.push(v.parse(sendMessage, args).MessageBody);
        return { MessageId: `message-${this.scanRequests.length}` };
      }
      case "arn:aws:states:::sns:publish": {
        const input = v.parse(publish, args);
        this.notices.push({
          message: input.Message,
          saga: input.MessageAttributes.saga.StringValue,
        });
        return { MessageId: `notice-${this.notices.length}` };
      }
      default:
        throw new Error(`the local world has no ${resource}`);
    }
  }

  #check(
    input: { ConditionExpression: string; ExpressionAttributeValues: Item },
    stored: Item | undefined,
  ): void {
    const holds = CONDITIONS[input.ConditionExpression];
    if (holds === undefined) {
      throw new Error(`the local table does not know "${input.ConditionExpression}"`);
    }
    if (!holds(stored, input.ExpressionAttributeValues)) {
      throw new TaskError(
        "DynamoDB.ConditionalCheckFailedException",
        "The conditional request failed",
      );
    }
  }
  // #endregion apply
}

const keyOf = (key: Item): string => JSON.stringify([key["pk"], key["sk"]]);
export const noteKey = (owner: string, noteId: string): string =>
  keyOf({ pk: { S: `OWNER#${owner}` }, sk: { S: `NOTE#${noteId}` } });
/** The string in an attribute, if it holds one. */
export const text = (value: Attribute | undefined): string | undefined =>
  value !== undefined && "S" in value ? value.S : undefined;

/** "SET #a = :x, #b = :y" and no other form of update expression. */
function assignments(input: v.InferOutput<typeof updateItem>): Item {
  const body = /^SET (.+)$/.exec(input.UpdateExpression)?.[1];
  if (body === undefined) {
    throw new Error(`the local table does not know "${input.UpdateExpression}"`);
  }
  return Object.fromEntries(
    body.split(",").map((part) => {
      const [name = "", value = ""] = part.split("=").map((side) => side.trim());
      const attributeName = input.ExpressionAttributeNames[name];
      const bound = input.ExpressionAttributeValues[value];
      if (attributeName === undefined || bound === undefined) {
        throw new Error(`the local table cannot resolve "${part.trim()}"`);
      }
      return [attributeName, bound];
    }),
  );
}
