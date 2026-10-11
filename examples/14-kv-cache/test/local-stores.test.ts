import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterAll, describe, it } from "vite-plus/test";
import { DynamoDbCacheStore, DynamoDbCounterStore } from "../src/dynamodb-store.ts";
import { openLocalValkey } from "../src/valkey-client.ts";
import { ValkeyCacheStore, ValkeyCounterStore } from "../src/valkey-store.ts";
import { describeCacheContract, describeCounterContract, fakeClock } from "./store-contracts.ts";

// Real servers on this machine: one Valkey node and DynamoDB Local. Passing
// here says nothing about IAM, TLS, cluster mode, or throttling in AWS.
const valkeyUrl = process.env["VALKEY_URL"];
const dynamoDbEndpoint = process.env["DYNAMODB_ENDPOINT"];
const tableName = process.env["TABLE_NAME"] ?? "aih-kv-local";

if (valkeyUrl === undefined) {
  describe("store contracts: Valkey", () => {
    it.skip("needs VALKEY_URL; run `vp run kv:test:local`", () => {});
  });
} else {
  const valkey = openLocalValkey(valkeyUrl, 2_000);
  const provider = async () => valkey.commands;
  afterAll(() => valkey.close());

  describeCounterContract("Valkey", async () => ({ store: new ValkeyCounterStore(provider), subject: randomUUID() }));
  describeCacheContract("Valkey", async () => ({
    store: new ValkeyCacheStore(provider),
    prefix: randomUUID(),
    // Valkey expires keys by its own clock, so time has to really pass.
    clock: { now: Date.now, advance: (ms) => sleep(ms) },
  }));
}

if (dynamoDbEndpoint === undefined) {
  describe("store contracts: DynamoDB Local", () => {
    it.skip("needs DYNAMODB_ENDPOINT; run `vp run kv:test:local`", () => {});
  });
} else {
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      endpoint: dynamoDbEndpoint,
      region: "ap-northeast-1",
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    }),
  );

  describeCounterContract("DynamoDB Local", async () => ({
    store: new DynamoDbCounterStore(client, tableName),
    subject: randomUUID(),
  }));
  describeCacheContract("DynamoDB Local", async () => ({
    store: new DynamoDbCacheStore(client, tableName),
    prefix: randomUUID(),
    // The store judges expiry by the time it is handed, so a fake clock is enough.
    clock: fakeClock(Date.now()),
  }));
}
