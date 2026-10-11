import { describe, expect, it } from "vite-plus/test";
import { parseHelloConfig } from "../lib/config.ts";

describe("hello config", () => {
  it("fills defaults when no context is given", () => {
    expect(parseHelloConfig({})).toEqual({ stage: "dev", noncurrentVersionDays: 7 });
  });

  it("accepts the string that `-c noncurrentVersionDays=30` produces", () => {
    expect(parseHelloConfig({ noncurrentVersionDays: "30" }).noncurrentVersionDays).toBe(30);
  });

  it("rejects a stage the stack does not know, naming the field", () => {
    expect(() => parseHelloConfig({ stage: "production" })).toThrow(/stage/);
  });

  it("rejects a retention that S3 lifecycle rules cannot express", () => {
    expect(() => parseHelloConfig({ noncurrentVersionDays: 0 })).toThrow(/noncurrentVersionDays/);
  });
});
