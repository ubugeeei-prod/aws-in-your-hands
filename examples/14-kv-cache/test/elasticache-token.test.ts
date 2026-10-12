import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { elastiCacheAuthToken } from "../src/elasticache-token.ts";

// Documentation example keys, not real ones.
const credentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  sessionToken: "IQoJb3JpZ2luX2VjEXAMPLE+/=",
};
const request = {
  cacheName: "Aih-KV-Cache",
  userId: "default.iam-user",
  region: "ap-northeast-1",
  credentials,
  now: new Date("2026-10-12T03:04:05Z"),
};

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const hmac = (key: string | Buffer, text: string): Buffer =>
  createHmac("sha256", key).update(text).digest();

describe("ElastiCache IAM auth token", () => {
  it("is the presigned connect request for the lowercased cache name, without a scheme", async () => {
    const token = await elastiCacheAuthToken(request);
    expect(token.startsWith("aih-kv-cache/?")).toBe(true);
    const query = new URLSearchParams(token.slice(token.indexOf("?") + 1));
    expect(Object.fromEntries(query)).toMatchObject({
      Action: "connect",
      User: "default.iam-user",
      ResourceType: "ServerlessCache",
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": "AKIAIOSFODNN7EXAMPLE/20261012/ap-northeast-1/elasticache/aws4_request",
      "X-Amz-Date": "20261012T030405Z",
      "X-Amz-Expires": "900",
      "X-Amz-SignedHeaders": "host",
      "X-Amz-Security-Token": credentials.sessionToken,
    });
  });

  // An independent SigV4 computation: what a verifier holding the same secret would derive.
  it("carries the signature of GET / on host <cache name>", async () => {
    const token = await elastiCacheAuthToken(request);
    const query = new URLSearchParams(token.slice(token.indexOf("?") + 1));
    const signature = query.get("X-Amz-Signature");
    query.delete("X-Amz-Signature");

    const canonicalQuery = [...query.entries()]
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      .toSorted()
      .join("&");
    const canonicalRequest = [
      "GET",
      "/",
      canonicalQuery,
      "host:aih-kv-cache",
      "",
      "host",
      sha256(""),
    ].join("\n");
    const scope = "20261012/ap-northeast-1/elasticache/aws4_request";
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      "20261012T030405Z",
      scope,
      sha256(canonicalRequest),
    ].join("\n");
    const key = ["20261012", "ap-northeast-1", "elasticache", "aws4_request"].reduce<
      string | Buffer
    >((secret, part) => hmac(secret, part), `AWS4${credentials.secretAccessKey}`);

    expect(signature).toBe(hmac(key, stringToSign).toString("hex"));
  });

  it("changes with the user, so a token for one user does not open another", async () => {
    const other = await elastiCacheAuthToken({ ...request, userId: "reporting" });
    expect(other).not.toBe(await elastiCacheAuthToken(request));
    expect(other).toContain("User=reporting");
  });
});
