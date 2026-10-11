import { describe, expect, it } from "vite-plus/test";
import { parseEnv } from "../src/env.ts";

describe("environment", () => {
  it("applies defaults for optional settings", () => {
    expect(parseEnv({ ALLOWED_ORIGIN: "https://d111.cloudfront.net" })).toEqual({
      ALLOWED_ORIGIN: "https://d111.cloudfront.net",
      LOG_LEVEL: "info",
      STAGE: "local",
    });
  });

  it("fails at start-up, naming the variable, when a required setting is missing", () => {
    expect(() => parseEnv({})).toThrow(/ALLOWED_ORIGIN/);
  });

  it("rejects a log level that the logger does not know", () => {
    expect(() => parseEnv({ ALLOWED_ORIGIN: "https://a.example", LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });
});
