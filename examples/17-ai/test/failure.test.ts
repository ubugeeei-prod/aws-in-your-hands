import { describe, expect, it } from "vite-plus/test";

import { parseEnv } from "../src/env.ts";
import { backoffMs, classifyError, nextDelayMs } from "../src/failure.ts";

const policy = { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 500 };
const named = (name: string) => Object.assign(new Error("x"), { name });

describe("classifying errors", () => {
  it("retries only what a second try can fix", () => {
    const retryable = [
      "ThrottlingException",
      "ServiceUnavailableException",
      "InternalServerException",
    ];
    const final = [
      "AccessDeniedException",
      "ResourceNotFoundException",
      "ValidationException",
      "ModelErrorException",
    ];
    for (const name of retryable) {
      expect(classifyError(named(name))?.retryable, name).toBe(true);
    }
    for (const name of final) {
      expect(classifyError(named(name))?.retryable, name).toBe(false);
    }
  });

  it("makes no claim about an error it does not know", () => {
    expect(classifyError(named("TypeError"))).toBeUndefined();
    expect(classifyError("a string")).toBeUndefined();
    expect(classifyError(undefined)).toBeUndefined();
  });
});

describe("backing off", () => {
  it("doubles the ceiling per attempt, caps it, and waits a random part of it", () => {
    expect([1, 2, 3, 4].map((attempt) => backoffMs(attempt, policy, () => 0.999))).toEqual([
      199, 399, 499, 499,
    ]);
    expect(backoffMs(3, policy, () => 0)).toBe(0);
    expect(backoffMs(2, policy, () => 0.5)).toBe(200);
  });

  it("stops at the last attempt and never waits for a final error", () => {
    const throttled = { code: "throttled", retryable: true } as const;
    expect(nextDelayMs(throttled, 2, policy, () => 0.5)).toBe(200);
    expect(nextDelayMs(throttled, 3, policy, () => 0.5)).toBeNull();
    expect(nextDelayMs({ code: "rejected", retryable: false }, 1, policy, () => 0.5)).toBeNull();
  });
});

describe("environment", () => {
  const valid = { AI_BACKEND: "fixture", BEDROCK_MODEL_ID: "jp.amazon.nova-2-lite-v1:0" };

  it("refuses to start without an explicit backend", () => {
    expect(() => parseEnv({ BEDROCK_MODEL_ID: valid.BEDROCK_MODEL_ID })).toThrow(/AI_BACKEND/);
    expect(() => parseEnv({ ...valid, AI_BACKEND: "openai" })).toThrow(/AI_BACKEND/);
  });

  it("keeps the output token limit within bounds", () => {
    expect(parseEnv(valid).MAX_OUTPUT_TOKENS).toBe(400);
    expect(parseEnv({ ...valid, MAX_OUTPUT_TOKENS: "120" }).MAX_OUTPUT_TOKENS).toBe(120);
    for (const value of ["0", "100000", "many"]) {
      expect(() => parseEnv({ ...valid, MAX_OUTPUT_TOKENS: value }), value).toThrow(
        /MAX_OUTPUT_TOKENS/,
      );
    }
  });
});
