import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetCommand, NumberValue, PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { documentClient } from "../src/document.ts";
import {
  json,
  type LocalEndpoint,
  localClientConfig,
  startLocalEndpoint,
} from "../src/local-endpoint.ts";
import { isolateSdkEnvironment } from "./support.ts";

let endpoint: LocalEndpoint;
let base: DynamoDBClient;
let stored: Record<string, unknown> = {};

beforeAll(async () => {
  isolateSdkEnvironment();
  endpoint = await startLocalEndpoint(() => json({ Item: stored }));
  base = new DynamoDBClient(localClientConfig(endpoint));
});
afterAll(async () => {
  base.destroy();
  await endpoint.close();
});

/** What goes on the wire for an item, or the error thrown before anything is sent. */
async function wire(Item: Record<string, unknown>): Promise<unknown> {
  endpoint.calls.length = 0;
  await documentClient(base).send(new PutCommand({ TableName: "notes", Item }));
  return JSON.parse(endpoint.calls[0]?.body.toString() ?? "{}").Item;
}

async function read(Item: Record<string, unknown>): Promise<Record<string, unknown>> {
  stored = Item;
  const output = await documentClient(base).send(new GetCommand({ TableName: "notes", Key: {} }));
  return output.Item ?? {};
}

describe("what the document client writes", () => {
  it("turns JavaScript values into DynamoDB's typed ones", async () => {
    expect(
      await wire({
        text: "a",
        count: 1,
        ratio: 1.5,
        done: true,
        nothing: null,
        list: [1, "a"],
        map: { x: 1 },
        tags: new Set(["a"]),
        scores: new Set([1, 2]),
        bytes: new Uint8Array([1, 2]),
        big: 10n,
      }),
    ).toEqual({
      text: { S: "a" },
      count: { N: "1" },
      ratio: { N: "1.5" },
      done: { BOOL: true },
      nothing: { NULL: true },
      list: { L: [{ N: "1" }, { S: "a" }] },
      map: { M: { x: { N: "1" } } },
      tags: { SS: ["a"] },
      scores: { NS: ["1", "2"] },
      bytes: { B: "AQI=" },
      big: { N: "10" },
    });
  });

  it("keeps an empty string as an empty string", async () => {
    expect(await wire({ title: "" })).toEqual({ title: { S: "" } });
  });

  it("drops a top-level attribute that is undefined, without a word", async () => {
    expect(await wire({ pk: "a", title: undefined })).toEqual({ pk: { S: "a" } });
  });

  it.each([
    ["undefined inside a map", { note: { title: undefined } }, "removeUndefinedValues"],
    ["an empty set", { tags: new Set() }, "non-empty set"],
    ["a Date", { createdAt: new Date(0) }, "convertClassInstanceToMap"],
    ["a number past the safe integers", { count: 2 ** 53 }, "MAX_SAFE_INTEGER"],
    ["NaN", { count: Number.NaN }, "NaN"],
  ])("refuses %s before sending anything", async (_name, item, hint) => {
    await expect(wire(item)).rejects.toThrow(hint);
    expect(endpoint.calls).toHaveLength(0);
  });

  it("sends a number of any size when it is given as digits", async () => {
    expect(await wire({ count: NumberValue.from("9007199254740993") })).toEqual({
      count: { N: "9007199254740993" },
    });
  });
});

describe("what the document client reads", () => {
  it("gives numbers as number, sets as Set, and binary as bytes", async () => {
    const item = await read({
      count: { N: "1" },
      scores: { NS: ["1"] },
      tags: { SS: ["a"] },
      bytes: { B: "AQI=" },
      nothing: { NULL: true },
    });

    expect(item).toEqual({
      count: 1,
      scores: new Set([1]),
      tags: new Set(["a"]),
      bytes: new Uint8Array([1, 2]),
      nothing: null,
    });
  });

  it("gives an integer too large for a number as a bigint, which JSON.stringify refuses", async () => {
    const item = await read({ count: { N: "9007199254740993" } });

    expect(item.count).toBe(9007199254740993n);
    expect(() => JSON.stringify(item)).toThrow(TypeError);
  });

  it("rounds a decimal with more digits than a double holds, silently", async () => {
    expect(await read({ ratio: { N: "1.00000000000000000001" } })).toEqual({ ratio: 1 });
  });
});
