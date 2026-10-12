import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { classify } from "../src/errors.ts";
import {
  json,
  type LocalEndpoint,
  localClientConfig,
  startLocalEndpoint,
} from "../src/local-endpoint.ts";
import { isolateSdkEnvironment } from "./support.ts";

beforeAll(() => isolateSdkEnvironment());

let endpoint: LocalEndpoint;
let client: DynamoDBClient;
// What a counter behind the endpoint would hold. The endpoint is ours: it adds, nothing more.
let noteCount: number;

async function losingTheFirstAnswer(config: object): Promise<void> {
  vi.spyOn(Math, "random").mockReturnValue(0);
  noteCount = 0;
  endpoint = await startLocalEndpoint((_call, index) => {
    noteCount += 1;
    // The write is applied, and its answer never arrives.
    return index === 0 ? { hang: true } : json({});
  });
  client = new DynamoDBClient({
    ...localClientConfig(endpoint),
    requestHandler: { requestTimeout: 50, throwOnRequestTimeout: true },
    ...config,
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  client.destroy();
  await endpoint.close();
});

const addOne = () =>
  new UpdateItemCommand({
    TableName: "notes",
    Key: { pk: { S: "OWNER#u1" }, sk: { S: "QUOTA" } },
    UpdateExpression: "ADD noteCount :one",
    ExpressionAttributeValues: { ":one": { N: "1" } },
  });

describe("a write whose answer is lost", () => {
  it("is sent again by the SDK, so one send adds twice", async () => {
    await losingTheFirstAnswer({});

    const output = await client.send(addOne());

    expect(output.$metadata.attempts).toBe(2);
    expect(noteCount).toBe(2);
  });

  it("is sent once with maxAttempts: 1, and the caller is told only that it does not know", async () => {
    await losingTheFirstAnswer({ maxAttempts: 1 });

    const error = await client.send(addOne()).catch((thrown: unknown) => thrown);

    expect(classify(error)).toEqual({ kind: "unavailable", attempts: 1 });
    expect(noteCount).toBe(1);
  });
});
