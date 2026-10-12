import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { INDEX, INDEX_PK, INDEX_SK } from "./keys.ts";
import {
  type Condition,
  type Item,
  type Key,
  type QueryInput,
  type QueryResult,
  type Reason,
  type SingleWrite,
  type Table,
  type TransactResult,
  type Write,
  type WriteResult,
} from "./table.ts";

type Expression = {
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
};

// #region condition
// Attribute names always go through placeholders: `count`, `size`, and `name` are among DynamoDB's reserved words.
export function conditionExpression(condition: Condition | undefined): Expression {
  switch (condition?.kind) {
    case undefined:
      return {};
    case "not_exists":
      // The key itself: true only when no item is stored under it.
      return { ConditionExpression: "attribute_not_exists(pk)" };
    case "exists":
      return { ConditionExpression: "attribute_exists(pk)" };
    case "equals":
      return {
        ConditionExpression: "#c = :c",
        ExpressionAttributeNames: { "#c": condition.attribute },
        ExpressionAttributeValues: { ":c": condition.value },
      };
    case "missing_or_less_than":
      return {
        ConditionExpression: "attribute_not_exists(#c) OR #c < :c",
        ExpressionAttributeNames: { "#c": condition.attribute },
        ExpressionAttributeValues: { ":c": condition.value },
      };
  }
}
// #endregion condition

// #region update
export function updateExpression(write: {
  set?: Record<string, unknown>;
  add?: Record<string, number>;
  remove?: string[];
}): { UpdateExpression: string; names: Record<string, string>; values: Record<string, unknown> } {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const clauses: string[] = [];

  const set = Object.entries(write.set ?? {}).map(([name, value], index) => {
    names[`#s${index}`] = name;
    values[`:s${index}`] = value;
    return `#s${index} = :s${index}`;
  });
  if (set.length > 0) {
    clauses.push(`SET ${set.join(", ")}`);
  }
  const remove = (write.remove ?? []).map((name, index) => {
    names[`#r${index}`] = name;
    return `#r${index}`;
  });
  if (remove.length > 0) {
    clauses.push(`REMOVE ${remove.join(", ")}`);
  }
  // ADD creates the number when it is missing, so a counter needs no first write.
  const add = Object.entries(write.add ?? {}).map(([name, amount], index) => {
    names[`#a${index}`] = name;
    values[`:a${index}`] = amount;
    return `#a${index} :a${index}`;
  });
  if (add.length > 0) {
    clauses.push(`ADD ${add.join(", ")}`);
  }
  return { UpdateExpression: clauses.join(" "), names, values };
}
// #endregion update

/** Drops the two maps when they are empty: DynamoDB refuses an empty one. */
function expression(
  condition: Condition | undefined,
  names: Record<string, string> = {},
  values: Record<string, unknown> = {},
): Expression {
  const built = conditionExpression(condition);
  const allNames = { ...names, ...built.ExpressionAttributeNames };
  const allValues = { ...values, ...built.ExpressionAttributeValues };
  return {
    ...(built.ConditionExpression === undefined
      ? {}
      : { ConditionExpression: built.ConditionExpression }),
    ...(Object.keys(allNames).length === 0 ? {} : { ExpressionAttributeNames: allNames }),
    ...(Object.keys(allValues).length === 0 ? {} : { ExpressionAttributeValues: allValues }),
  };
}

function putInput(tableName: string, write: Extract<Write, { kind: "put" }>) {
  return { TableName: tableName, Item: write.item, ...expression(write.condition) };
}

function updateInput(tableName: string, write: Extract<Write, { kind: "update" }>) {
  const { UpdateExpression, names, values } = updateExpression(write);
  return {
    TableName: tableName,
    Key: write.key,
    UpdateExpression,
    ...expression(write.condition, names, values),
  };
}

function deleteInput(tableName: string, write: Extract<Write, { kind: "delete" | "check" }>) {
  return { TableName: tableName, Key: write.key, ...expression(write.condition) };
}

// #region transact-items
type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

export function transactItems(tableName: string, writes: Write[]): TransactItem[] {
  return writes.map((write): TransactItem => {
    switch (write.kind) {
      case "put":
        return { Put: putInput(tableName, write) };
      case "update":
        return { Update: updateInput(tableName, write) };
      case "delete":
        return { Delete: deleteInput(tableName, write) };
      case "check": {
        const { ConditionExpression = "", ...rest } = deleteInput(tableName, write);
        return { ConditionCheck: { ...rest, ConditionExpression } };
      }
    }
  });
}
// #endregion transact-items

// #region query-input
export function queryInput(tableName: string, input: QueryInput) {
  const onIndex = input.index !== undefined;
  const names: Record<string, string> = { "#pk": onIndex ? INDEX_PK : "pk" };
  const values: Record<string, unknown> = { ":pk": input.pk };
  let keyCondition = "#pk = :pk";
  if (input.sk !== undefined) {
    names["#sk"] = onIndex ? INDEX_SK : "sk";
    if ("beginsWith" in input.sk) {
      values[":sk"] = input.sk.beginsWith;
      keyCondition += " AND begins_with(#sk, :sk)";
    } else {
      [values[":from"], values[":to"]] = input.sk.between;
      keyCondition += " AND #sk BETWEEN :from AND :to";
    }
  }
  return {
    TableName: tableName,
    ...(onIndex ? { IndexName: input.index } : {}),
    KeyConditionExpression: keyCondition,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ScanIndexForward: input.descending !== true,
    ...(input.limit === undefined ? {} : { Limit: input.limit }),
    ...(input.after === undefined ? {} : { ExclusiveStartKey: input.after }),
    ...(input.consistent === true ? { ConsistentRead: true } : {}),
  };
}
// #endregion query-input

// What comes back is outside data: at least the two keys must be there, as strings.
const itemSchema = v.looseObject({ pk: v.string(), sk: v.string() });
const keySchema = v.record(v.string(), v.string());
const toItem = (value: unknown): Item => v.parse(itemSchema, value);

const REASONS: Record<string, Reason> = {
  None: "none",
  ConditionalCheckFailed: "condition_failed",
  TransactionConflict: "conflict",
};

export class DynamoDbTable implements Table {
  readonly #client: Pick<DynamoDBDocumentClient, "send">;
  readonly #tableName: string;

  constructor(client: Pick<DynamoDBDocumentClient, "send">, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  async get(key: Key, options: { consistent?: boolean } = {}): Promise<Item | undefined> {
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.#tableName,
        Key: key,
        ...(options.consistent === true ? { ConsistentRead: true } : {}),
      }),
    );
    return result.Item === undefined ? undefined : toItem(result.Item);
  }

  async query(input: QueryInput): Promise<QueryResult> {
    if (input.index !== undefined && input.index !== INDEX) {
      throw new Error(`Unknown index ${input.index}`);
    }
    const result = await this.#client.send(new QueryCommand(queryInput(this.#tableName, input)));
    return {
      items: (result.Items ?? []).map(toItem),
      ...(result.LastEvaluatedKey === undefined
        ? {}
        : { last: v.parse(keySchema, result.LastEvaluatedKey) }),
    };
  }

  // #region write
  async write(write: SingleWrite): Promise<WriteResult> {
    try {
      switch (write.kind) {
        case "put":
          await this.#client.send(new PutCommand(putInput(this.#tableName, write)));
          break;
        case "update":
          await this.#client.send(new UpdateCommand(updateInput(this.#tableName, write)));
          break;
        case "delete":
          await this.#client.send(new DeleteCommand(deleteInput(this.#tableName, write)));
          break;
      }
      return "ok";
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return "condition_failed";
      }
      throw error;
    }
  }
  // #endregion write

  // #region transact
  async transact(writes: Write[]): Promise<TransactResult> {
    try {
      await this.#client.send(
        new TransactWriteCommand({ TransactItems: transactItems(this.#tableName, writes) }),
      );
      return { ok: true };
    } catch (error) {
      if (!(error instanceof TransactionCanceledException)) {
        throw error;
      }
      // One entry per action, in the order sent. Anything this code has no
      // answer for (throttling, a size limit) stays an exception.
      const reasons = (error.CancellationReasons ?? []).map((reason) => REASONS[reason.Code ?? ""]);
      if (reasons.length !== writes.length || reasons.some((reason) => reason === undefined)) {
        throw error;
      }
      return { ok: false, reasons: reasons.filter((reason) => reason !== undefined) };
    }
  }
  // #endregion transact

  async scan(input: { limit: number; after?: Key }): Promise<{ items: Item[]; last?: Key }> {
    const result = await this.#client.send(
      new ScanCommand({
        TableName: this.#tableName,
        Limit: input.limit,
        ...(input.after === undefined ? {} : { ExclusiveStartKey: input.after }),
      }),
    );
    const last = result.LastEvaluatedKey;
    return {
      items: (result.Items ?? []).map(toItem),
      ...(last === undefined ? {} : { last: v.parse(itemSchema, last) }),
    };
  }
}
