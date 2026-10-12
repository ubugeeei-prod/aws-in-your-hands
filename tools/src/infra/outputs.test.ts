import { describe, expect, it } from "vite-plus/test";

import { parseOutputs, requireOutput } from "./outputs.ts";

describe("stack outputs", () => {
  it("reads outputs from the state document", () => {
    const stdout = JSON.stringify({
      state: {
        stackName: "AihBookSite",
        version: 11,
        resources: {},
        outputs: { DistributionId: "E123" },
      },
      lock: null,
    });
    expect(parseOutputs(stdout)).toEqual({ DistributionId: "E123" });
  });

  it("rejects output of an unexpected shape", () => {
    expect(() => parseOutputs("Stack not found")).toThrow(/did not print JSON/);
    expect(() => parseOutputs(JSON.stringify({ outputs: {} }))).toThrow();
  });

  it("finds an output by bare or stack-qualified key", () => {
    expect(requireOutput({ DistributionId: "E1" }, "DistributionId")).toBe("E1");
    expect(requireOutput({ "AihBookSite.DistributionId": "E1" }, "DistributionId")).toBe("E1");
  });

  it("refuses a missing or ambiguous output", () => {
    expect(() => requireOutput({}, "DistributionId")).toThrow(/found 0/);
    expect(() =>
      requireOutput({ "A.DistributionId": "E1", "B.DistributionId": "E2" }, "DistributionId"),
    ).toThrow(/found 2/);
  });
});
