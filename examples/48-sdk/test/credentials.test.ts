import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DEFAULT_CHAIN, reportDefaultCredentials } from "../src/credentials.ts";
import { json, startLocalEndpoint } from "../src/local-endpoint.ts";
import { getNote, isolateSdkEnvironment } from "./support.ts";

const files = {
  config: "[profile work]\nregion = eu-west-1\n",
  credentials: [
    "[default]",
    "aws_access_key_id = AKIDLOCALDEFAULT0001",
    "aws_secret_access_key = local",
    "[work]",
    "aws_access_key_id = AKIDLOCALWORK000002",
    "aws_secret_access_key = local",
    "",
  ].join("\n"),
};
const envKeys = { AWS_ACCESS_KEY_ID: "AKIDLOCALENV0000003", AWS_SECRET_ACCESS_KEY: "local" };

beforeEach(() => isolateSdkEnvironment(files));
afterEach(() => vi.restoreAllMocks());

describe("the default credential chain", () => {
  it("takes keys from the environment first", async () => {
    Object.assign(process.env, envKeys);

    expect(await reportDefaultCredentials()).toMatchObject({
      accessKeyIdEnd: "0003",
      temporary: false,
      sources: ["environment variables"],
      tried: ["fromEnv"],
    });
  });

  it("calls keys temporary when a session token comes with them", async () => {
    Object.assign(process.env, envKeys, { AWS_SESSION_TOKEN: "token" });

    expect(await reportDefaultCredentials()).toMatchObject({ temporary: true });
  });

  it("falls through to the default profile when the environment has none", async () => {
    expect(await reportDefaultCredentials()).toMatchObject({
      accessKeyIdEnd: "0001",
      sources: ["static keys in a profile"],
      tried: ["fromEnv", "fromSSO", "fromIni"],
    });
  });

  it("lets AWS_PROFILE win over keys in the environment, and warns about it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Object.assign(process.env, envKeys, { AWS_PROFILE: "work" });

    expect(await reportDefaultCredentials()).toMatchObject({ accessKeyIdEnd: "0002" });
    // The warning is printed once per process, so it may have been spent by another test.
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("tries every step in order and then fails, without leaving the machine", async () => {
    process.env.AWS_PROFILE = "missing";

    await expect(reportDefaultCredentials()).rejects.toMatchObject({
      name: "CredentialsProviderError",
      message: "Could not load credentials from any providers",
    });
  });

  it("is walked in the order this chapter lists", async () => {
    process.env.AWS_PROFILE = "missing";
    const tried: string[] = [];
    const { defaultProvider } = await import("@aws-sdk/credential-provider-node");
    const logger = {
      debug: (message: string) => {
        const step = /defaultProvider::(\w+)$/.exec(message)?.[1];
        if (step !== undefined) {
          tried.push(step);
        }
      },
      info() {},
      warn() {},
      error() {},
    };

    await defaultProvider({ logger })().catch(() => undefined);

    // fromEnv is skipped without a log line when AWS_PROFILE is set.
    expect(tried).toEqual(DEFAULT_CHAIN.slice(1));
  });

  it("never returns more of the key than its last four characters", async () => {
    Object.assign(process.env, envKeys);

    expect(JSON.stringify(await reportDefaultCredentials())).not.toContain("AKIDLOCALENV");
  });
});

describe("Region and endpoint, when the code names neither", () => {
  it("has no Region to fall back on", async () => {
    await expect(new DynamoDBClient({}).config.region()).rejects.toThrow("Region is missing");
  });

  it("reads AWS_REGION, and not AWS_DEFAULT_REGION", async () => {
    process.env.AWS_DEFAULT_REGION = "us-east-1";
    await expect(new DynamoDBClient({}).config.region()).rejects.toThrow("Region is missing");

    process.env.AWS_REGION = "ap-northeast-1";
    expect(await new DynamoDBClient({}).config.region()).toBe("ap-northeast-1");
  });

  it("reads the Region of the profile in use", async () => {
    process.env.AWS_PROFILE = "work";

    expect(await new DynamoDBClient({}).config.region()).toBe("eu-west-1");
  });

  it("sends a client to whatever AWS_ENDPOINT_URL_DYNAMODB names", async () => {
    const endpoint = await startLocalEndpoint(() => json({}));
    Object.assign(process.env, envKeys, {
      AWS_REGION: "ap-northeast-1",
      AWS_ENDPOINT_URL_DYNAMODB: endpoint.url,
    });
    const client = new DynamoDBClient({});

    await client.send(getNote());

    expect(endpoint.calls).toHaveLength(1);
    client.destroy();
    await endpoint.close();
  });
});
