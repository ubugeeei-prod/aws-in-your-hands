import { describe, expect, it } from "vite-plus/test";

import { parseEnv } from "../src/env.ts";

describe("environment", () => {
  it("needs nothing but the store's name to run in memory", () => {
    expect(parseEnv({ KV_STORE: "memory" })).toMatchObject({
      RATE_LIMIT: 5,
      RATE_WINDOW_SECONDS: 60,
      RATE_ALGORITHM: "fixed",
      RATE_ON_ERROR: "allow",
      CACHE_TTL_SECONDS: 30,
    });
  });

  it("refuses to start without saying where the counters and the cache live", () => {
    expect(() => parseEnv({})).toThrow(/KV_STORE/);
  });

  it("requires each store's own settings", () => {
    expect(() => parseEnv({ KV_STORE: "dynamodb" })).toThrow(/TABLE_NAME/);
    expect(() => parseEnv({ KV_STORE: "valkey" })).toThrow(/VALKEY_URL/);
    expect(() =>
      parseEnv({ KV_STORE: "elasticache", VALKEY_ENDPOINT: "x.cache.amazonaws.com" }),
    ).toThrow(/VALKEY_CACHE_NAME/);
  });

  it("accepts the settings the stack passes for ElastiCache", () => {
    expect(
      parseEnv({
        KV_STORE: "elasticache",
        VALKEY_ENDPOINT: "aih-kv-cache-abc123.public.serverless.apne1.cache.amazonaws.com",
        VALKEY_PORT: "6379",
        VALKEY_CACHE_NAME: "aih-kv-cache",
        VALKEY_USER: "default.iam-user",
        AWS_REGION: "ap-northeast-1",
      }),
    ).toMatchObject({ VALKEY_PORT: 6379 });
  });

  it("rejects a limit of zero and a Valkey URL without a scheme", () => {
    expect(() => parseEnv({ KV_STORE: "memory", RATE_LIMIT: "0" })).toThrow(/RATE_LIMIT/);
    expect(() => parseEnv({ KV_STORE: "valkey", VALKEY_URL: "localhost:6390" })).toThrow(
      /VALKEY_URL/,
    );
  });
});
