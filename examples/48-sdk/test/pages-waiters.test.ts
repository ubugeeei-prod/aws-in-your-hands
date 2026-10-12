import { DynamoDBClient, waitUntilTableExists } from "@aws-sdk/client-dynamodb";
import * as v from "valibot";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import {
  json,
  jsonError,
  type LocalEndpoint,
  localClientConfig,
  type Script,
  startLocalEndpoint,
} from "../src/local-endpoint.ts";
import { scanPages } from "../src/pages.ts";
import { isolateSdkEnvironment } from "./support.ts";

beforeAll(() => isolateSdkEnvironment());

let endpoint: LocalEndpoint;
let client: DynamoDBClient;

async function against(script: Script): Promise<void> {
  endpoint = await startLocalEndpoint(script);
  client = new DynamoDBClient({ ...localClientConfig(endpoint), maxAttempts: 1 });
}

afterEach(async () => {
  client.destroy();
  await endpoint.close();
});

const scanBodySchema = v.object({
  Limit: v.optional(v.number()),
  ExclusiveStartKey: v.optional(v.object({ pk: v.object({ S: v.string() }) })),
});

// A table of `total` items, handed out one per page, the way Scan does: a key to continue from.
const table =
  (total: number): Script =>
  (call) => {
    const body = v.parse(scanBodySchema, JSON.parse(call.body.toString()));
    const next = Number(body.ExclusiveStartKey?.pk.S ?? "0") + 1;
    return json({
      Items: [{ pk: { S: String(next) } }],
      ...(next < total ? { LastEvaluatedKey: { pk: { S: String(next) } } } : {}),
    });
  };

describe("the Scan paginator", () => {
  it("passes each LastEvaluatedKey back as ExclusiveStartKey until there is none", async () => {
    await against(table(3));

    const scanned = await scanPages(client, { TableName: "notes" }, { pageSize: 1, maxPages: 10 });

    expect(scanned).toMatchObject({ complete: true, pages: 3 });
    expect(scanned.items).toEqual([{ pk: { S: "1" } }, { pk: { S: "2" } }, { pk: { S: "3" } }]);
    expect(endpoint.calls.map((call) => JSON.parse(call.body.toString()))).toEqual([
      { TableName: "notes", Limit: 1 },
      { TableName: "notes", Limit: 1, ExclusiveStartKey: { pk: { S: "1" } } },
      { TableName: "notes", Limit: 1, ExclusiveStartKey: { pk: { S: "2" } } },
    ]);
  });

  it("sends nothing more once the loop is left", async () => {
    await against(table(1000));

    const scanned = await scanPages(client, { TableName: "notes" }, { pageSize: 1, maxPages: 4 });

    expect(scanned).toMatchObject({ complete: false, pages: 4 });
    expect(endpoint.calls).toHaveLength(4);
  });
});

describe("waitUntilTableExists", () => {
  const quick = { maxWaitTime: 2, minDelay: 0.01, maxDelay: 0.02 };

  it("polls DescribeTable through not-found and CREATING until the table is ACTIVE", async () => {
    await against((_call, index) => {
      if (index === 0) {
        return jsonError(400, "ResourceNotFoundException");
      }
      return json({ Table: { TableStatus: index < 3 ? "CREATING" : "ACTIVE" } });
    });

    const result = await waitUntilTableExists({ client, ...quick }, { TableName: "notes" });

    expect(result.state).toBe("SUCCESS");
    expect(endpoint.calls.map((call) => call.operation)).toEqual(Array(4).fill("DescribeTable"));
  });

  it("gives up after maxWaitTime with a TimeoutError", async () => {
    await against(() => json({ Table: { TableStatus: "CREATING" } }));

    await expect(
      waitUntilTableExists({ client, ...quick, maxWaitTime: 0.2 }, { TableName: "notes" }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("keeps polling through an error that will never go away", async () => {
    await against(() => jsonError(400, "AccessDeniedException"));

    await expect(
      waitUntilTableExists({ client, ...quick, maxWaitTime: 0.2 }, { TableName: "notes" }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    // Not one refusal reported: the waiter asked again and again until its time ran out.
    expect(endpoint.calls.length).toBeGreaterThan(3);
  });

  it("stops when its AbortSignal fires", async () => {
    await against(() => json({ Table: { TableStatus: "CREATING" } }));

    await expect(
      waitUntilTableExists(
        { client, ...quick, abortSignal: AbortSignal.timeout(50) },
        { TableName: "notes" },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
