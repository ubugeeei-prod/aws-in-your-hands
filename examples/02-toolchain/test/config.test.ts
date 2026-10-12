import { describe, expect, it } from "vite-plus/test";

import { parseHelloConfig } from "../lib/config.ts";

describe("hello config", () => {
  it("fills defaults", () => {
    expect(parseHelloConfig({})).toEqual({ stage: "dev", noncurrentVersionDays: 7 });
  });

  it("accepts the string from `-c noncurrentVersionDays=30`", () => {
    expect(parseHelloConfig({ noncurrentVersionDays: "30" }).noncurrentVersionDays).toBe(30);
  });

  it("rejects an unknown stage, naming the field", () => {
    expect(() => parseHelloConfig({ stage: "production" })).toThrow(/stage/);
  });

  it("rejects a retention of 0 days", () => {
    expect(() => parseHelloConfig({ noncurrentVersionDays: 0 })).toThrow(/noncurrentVersionDays/);
  });
});
