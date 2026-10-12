import { describe, expect, it } from "vite-plus/test";

import { parseManagedConfig } from "../src/config.ts";
import { instanceCeiling } from "../src/cost.ts";

describe("stack settings", () => {
  it("defaults to the smallest fleet this chapter priced", () => {
    expect(parseManagedConfig({})).toEqual({
      allowedOrigin: "http://localhost:5173",
      instanceType: "m6g.large",
      minExecutionEnvironments: 3,
      maxExecutionEnvironments: 6,
      maxVCpuCount: 12,
    });
  });

  it("reads numbers from the command line, where they arrive as strings", () => {
    const config = parseManagedConfig({ maxVCpuCount: "16", maxExecutionEnvironments: "8" });
    expect(config.maxVCpuCount).toBe(16);
    expect(instanceCeiling(config.maxVCpuCount)).toBe(8);
  });

  it("refuses an instance type whose price was not looked up", () => {
    expect(() => parseManagedConfig({ instanceType: "c7g.large" })).toThrow(/instanceType/);
  });

  it("refuses a vCPU ceiling below the 12 that CDK accepts", () => {
    expect(() => parseManagedConfig({ maxVCpuCount: 8 })).toThrow(/maxVCpuCount/);
  });

  it("refuses a minimum above the maximum", () => {
    expect(() =>
      parseManagedConfig({ minExecutionEnvironments: 7, maxExecutionEnvironments: 6 }),
    ).toThrow(/must not exceed/);
  });

  it("takes zero and zero, which switches the function off, and no other zero", () => {
    expect(
      parseManagedConfig({ minExecutionEnvironments: 0, maxExecutionEnvironments: 0 }),
    ).toMatchObject({ minExecutionEnvironments: 0, maxExecutionEnvironments: 0 });
    expect(() => parseManagedConfig({ minExecutionEnvironments: 0 })).toThrow(/only when/);
  });

  it("refuses an origin without a scheme", () => {
    expect(() => parseManagedConfig({ allowedOrigin: "localhost:5173" })).toThrow(/allowedOrigin/);
  });
});
