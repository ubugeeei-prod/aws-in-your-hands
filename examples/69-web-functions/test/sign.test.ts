import { createHash } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { signRequest } from "../src/sign.ts";

// A made-up key pair. It opens nothing.
const credentials = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "not-a-real-secret",
};
const endpoint = "https://bcdfghjklmnpqrst.b7t.lambda-web.ap-northeast-1.on.aws";
const sign = (input: { path: string; method: string; body?: string }) =>
  signRequest({
    url: `${endpoint}${input.path}`,
    method: input.method,
    ...(input.body === undefined ? {} : { body: input.body }),
    region: "ap-northeast-1",
    credentials,
    now: new Date("2026-10-13T00:00:00.000Z"),
  });

describe("a request for an IamAuth endpoint", () => {
  it("is signed for the service lambda in the endpoint's Region", async () => {
    const { headers } = await sign({ path: "/health", method: "GET" });
    expect(headers["authorization"]).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261013\/ap-northeast-1\/lambda\/aws4_request, /,
    );
    expect(headers["host"]).toBe("bcdfghjklmnpqrst.b7t.lambda-web.ap-northeast-1.on.aws");
  });

  it("carries the body's hash in a signed header, even when there is no body", async () => {
    const empty = await sign({ path: "/health", method: "GET" });
    expect(empty.headers["x-amz-content-sha256"]).toBe(
      createHash("sha256").update("").digest("hex"),
    );
    expect(empty.headers["authorization"]).toMatch(/SignedHeaders=[^,]*x-amz-content-sha256/);

    const body = JSON.stringify({ title: "a", body: "" });
    const posted = await sign({ path: "/notes", method: "POST", body });
    expect(posted.headers["x-amz-content-sha256"]).toBe(
      createHash("sha256").update(body).digest("hex"),
    );
  });

  it("gives a different signature for a different path: one signature opens one request", async () => {
    const signature = async (path: string) =>
      (await sign({ path, method: "GET" })).headers["authorization"];
    expect(await signature("/health")).not.toBe(await signature("/notes"));
  });
});
