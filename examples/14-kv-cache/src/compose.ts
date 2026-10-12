import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { type App, createApp } from "./app.ts";
import { createSlowCatalog } from "./catalog.ts";
import { itemSchema } from "./contract.ts";
import { DynamoDbCacheStore, DynamoDbCounterStore } from "./dynamodb-store.ts";
import { type Env, parseEnv } from "./env.ts";
import { createLogger, type Logger } from "./log.ts";
import { MemoryCacheStore, MemoryCounterStore } from "./memory-store.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { createReadThrough } from "./read-through.ts";
import type { CacheStore, CounterStore } from "./stores.ts";
import { openElastiCache, openLocalValkey, rotating } from "./valkey-client.ts";
import { ValkeyCacheStore, ValkeyCounterStore, type ValkeyProvider } from "./valkey-store.ts";

const VALKEY_TIMEOUT_MS = 1_000;

// #region stores
export function createStores(env: Env, log: Logger): { counters: CounterStore; cache: CacheStore } {
  if (env.KV_STORE === "memory") {
    return { counters: new MemoryCounterStore(), cache: new MemoryCacheStore() };
  }
  if (env.KV_STORE === "dynamodb") {
    const client = DynamoDBDocumentClient.from(
      new DynamoDBClient(
        env.DYNAMODB_ENDPOINT === undefined
          ? {}
          : {
              endpoint: env.DYNAMODB_ENDPOINT,
              region: "ap-northeast-1",
              // DynamoDB Local accepts any credentials; these are not real ones.
              credentials: { accessKeyId: "local", secretAccessKey: "local" },
            },
      ),
    );
    return {
      counters: new DynamoDbCounterStore(client, env.TABLE_NAME),
      cache: new DynamoDbCacheStore(client, env.TABLE_NAME),
    };
  }
  let valkey: ValkeyProvider;
  if (env.KV_STORE === "valkey") {
    const local = openLocalValkey(env.VALKEY_URL, VALKEY_TIMEOUT_MS);
    valkey = async () => local.commands;
  } else {
    valkey = rotating({
      open: () =>
        openElastiCache({
          endpoint: env.VALKEY_ENDPOINT,
          port: env.VALKEY_PORT,
          cacheName: env.VALKEY_CACHE_NAME,
          userId: env.VALKEY_USER,
          region: env.AWS_REGION,
          credentials: defaultProvider(),
          timeoutMs: VALKEY_TIMEOUT_MS,
          now: () => new Date(),
          onError: (error) =>
            log({ level: "warn", message: "valkey connection error", error: error.message }),
        }),
      // The token lasts 15 minutes; replace the connection well before a reconnect could need a new one.
      maxAgeMs: 10 * 60_000,
      now: Date.now,
    });
  }
  return { counters: new ValkeyCounterStore(valkey), cache: new ValkeyCacheStore(valkey) };
}
// #endregion stores

export function composeApp(source: Record<string, string | undefined>): App {
  const env = parseEnv(source);
  const log = createLogger(env.LOG_LEVEL);
  const { counters, cache } = createStores(env, log);
  return createApp({
    env,
    log,
    limiter: createRateLimiter(counters, {
      limit: env.RATE_LIMIT,
      windowMs: env.RATE_WINDOW_SECONDS * 1000,
      algorithm: env.RATE_ALGORITHM,
    }),
    source: createSlowCatalog(env.SOURCE_DELAY_MS, (ms) => sleep(ms)),
    cache: createReadThrough({
      store: cache,
      schema: z.array(itemSchema),
      ttlMs: env.CACHE_TTL_SECONDS * 1000,
      jitter: 0.2,
      random: Math.random,
      now: Date.now,
      // One refill at a time across execution environments. In memory there is nobody to coordinate with.
      ...(env.KV_STORE === "memory"
        ? {}
        : {
            lock: {
              ttlMs: 5_000,
              waitMs: 100,
              maxWaits: 20,
              newOwner: randomUUID,
              sleep: (ms: number) => sleep(ms),
            },
          }),
      onStoreError: (error) =>
        log({ level: "warn", message: "cache store failed", error: String(error) }),
    }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
