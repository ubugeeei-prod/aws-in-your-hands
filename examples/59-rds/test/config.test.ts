import { describe, expect, it } from "vite-plus/test";

import { parseRdsConfig, PROFILES } from "../src/config.ts";
import { parseEnv } from "../src/env.ts";

describe("stack configuration", () => {
  it("defaults to the cheapest instance that can be thrown away", () => {
    expect(parseRdsConfig({})).toEqual({
      allowedOrigin: "http://localhost:5173",
      profile: "practice",
      postgresVersion: "18.3",
      instanceClass: "t4g.micro",
      readReplica: false,
    });
    expect(PROFILES.practice).toMatchObject({ multiAz: false, deletionProtection: false });
  });

  it("reads context strings, and refuses what it cannot mean", () => {
    expect(parseRdsConfig({ readReplica: "true", profile: "production" })).toMatchObject({
      readReplica: true,
      profile: "production",
    });
    for (const context of [
      { readReplica: "yes" },
      { profile: "prod" },
      { postgresVersion: "18" },
      { postgresVersion: "9.6" },
      { instanceClass: "db.t4g.micro; rm" },
      { allowedOrigin: "localhost:5173" },
    ]) {
      expect(() => parseRdsConfig(context), JSON.stringify(context)).toThrow();
    }
  });
});

describe("function environment", () => {
  const valid = {
    ALLOWED_ORIGIN: "https://d111.cloudfront.net",
    AWS_REGION: "ap-northeast-1",
    DB_HOST: "aih-notes.abcdefghijkl.ap-northeast-1.rds.amazonaws.com",
    DB_PORT: "5432",
    DB_NAME: "notes",
  };

  it("takes the endpoint name, and no replica unless one is named", () => {
    expect(parseEnv(valid)).toMatchObject({
      DB_PORT: 5432,
      DB_REPLICA_HOST: "",
      LOG_LEVEL: "info",
    });
    expect(parseEnv({ ...valid, DB_REPLICA_HOST: "" }).DB_REPLICA_HOST).toBe("");
  });

  it("refuses an address in place of the endpoint name", () => {
    // After a failover the name points at another address. An address would not follow.
    expect(() => parseEnv({ ...valid, DB_HOST: "10.20.128.14" })).toThrow(/DB_HOST/);
    expect(() => parseEnv({ ...valid, DB_PORT: "0" })).toThrow(/DB_PORT/);
    expect(() => parseEnv({ ...valid, DB_PORT: "70000" })).toThrow(/DB_PORT/);
  });
});
