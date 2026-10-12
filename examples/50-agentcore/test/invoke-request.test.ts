import { describe, expect, it } from "vite-plus/test";

import { SESSION_HEADER } from "../src/contract.ts";
import { invocationRequest } from "../src/invoke-request.ts";

describe("the request that invokes a runtime with a bearer token", () => {
  it("puts the whole ARN in one path segment and names the endpoint", () => {
    const { url, init } = invocationRequest(
      {
        region: "ap-northeast-1",
        runtimeArn:
          "arn:aws:bedrock-agentcore:ap-northeast-1:111122223333:runtime/AihNotesAgent-abcdefghij",
        qualifier: "DEFAULT",
      },
      { accessToken: "token", sessionId: "s".repeat(40), prompt: "こんにちは" },
    );
    expect(url).toBe(
      "https://bedrock-agentcore.ap-northeast-1.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aap-northeast-1%3A111122223333%3Aruntime%2FAihNotesAgent-abcdefghij/invocations?qualifier=DEFAULT",
    );
    expect(init.headers).toMatchObject({
      authorization: "Bearer token",
      [SESSION_HEADER]: "s".repeat(40),
    });
    // The body is this agent's own contract: a prompt, and nothing that names a user.
    expect(JSON.parse(init.body)).toEqual({ prompt: "こんにちは" });
  });
});
