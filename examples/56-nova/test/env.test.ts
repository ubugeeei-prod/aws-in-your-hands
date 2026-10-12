import { describe, expect, it } from "vite-plus/test";

import { parseEnv } from "../src/env.ts";

const base = { NOVA_BACKEND: "scripted", DESCRIBE_MODEL_ID: "jp.amazon.nova-2-lite-v1:0" };

describe("the environment", () => {
  it("fills in the limits, and never the backend", () => {
    expect(parseEnv(base)).toMatchObject({
      MAX_OUTPUT_TOKENS: 300,
      INFERENCE_TIMEOUT_MS: 30_000,
      LEASE_SECONDS: 60,
      DESCRIPTION_LANGUAGE: "ja",
    });
    expect(() => parseEnv({ DESCRIBE_MODEL_ID: base.DESCRIBE_MODEL_ID })).toThrow(/NOVA_BACKEND/);
  });

  it.each([
    ["a retired model", "amazon.nova-canvas-v1:0", /end of life on 2026-09-30/],
    [
      "a model ID where Tokyo needs a profile",
      "amazon.nova-2-lite-v1:0",
      /jp\.amazon\.nova-2-lite/,
    ],
    ["a model with no confirmed route", "amazon.nova-micro-v1:0", /no route from ap-northeast-1/],
    ["a model that does not read images", "amazon.nova-2-sonic-v1:0", /does not take an image/],
    ["a typo", "jp.amazon.nova-2-lite-v1", /not in src\/catalog\.ts/],
  ])("stops at start-up for %s", (_name, id, reason) => {
    expect(() => parseEnv({ ...base, DESCRIBE_MODEL_ID: id })).toThrow(reason);
  });

  it("refuses a lease that could end while its own call is still running", () => {
    expect(() => parseEnv({ ...base, LEASE_SECONDS: "30", INFERENCE_TIMEOUT_MS: "30000" })).toThrow(
      /LEASE_SECONDS must be longer/,
    );
  });

  it("needs a bucket before it will call Bedrock", () => {
    expect(() => parseEnv({ ...base, NOVA_BACKEND: "bedrock" })).toThrow(/MEDIA_BUCKET/);
    expect(parseEnv({ ...base, NOVA_BACKEND: "bedrock", MEDIA_BUCKET: "media" }).MEDIA_BUCKET).toBe(
      "media",
    );
  });
});
