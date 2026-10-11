import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { buildReport, GATE_EXIT, type RunResult, summarize } from "./report.ts";

const fixture = (name: string): RunResult =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as RunResult;

const check = (name: string, requestedStacks = ["AihBookSite"]) =>
  buildReport({
    requestedStacks,
    run: fixture(name),
    target: { accountId: "111111111111", region: "ap-northeast-1" },
    executedAt: new Date("2026-10-11T12:00:00Z"),
    toolVersion: "0.296.28",
  });

describe("drift report", () => {
  it("passes only when every resource was compared and matches", () => {
    const report = check("clean");
    expect(report.status).toBe("clean");
    expect(report.gate).toMatchObject({ passed: true, exitCode: GATE_EXIT.clean });
    expect(report.stacks[0]?.counts).toEqual({ clean: 4, drifted: 0, deleted: 0, uninspected: 0 });
  });

  it("names the property that drifted", () => {
    const report = check("drifted");
    expect(report.status).toBe("drifted");
    expect(report.gate.exitCode).toBe(GATE_EXIT.differs);
    expect(report.stacks[0]?.drifted).toEqual([
      { logicalId: "Distribution", type: "AWS::CloudFront::Distribution", paths: ["DistributionConfig.Comment"] },
    ]);
  });

  it("reports a resource deleted outside the tool", () => {
    const report = check("deleted");
    expect(report.status).toBe("deleted");
    expect(report.gate.exitCode).toBe(GATE_EXIT.differs);
  });

  it("does not call a stack in sync when a resource type cannot be read back", () => {
    // cdkd exits 0 here. The gate must still fail: three resources match and
    // one was never looked at.
    const report = check("unsupported");
    expect(report.exitCode).toBe(0);
    expect(report.status).toBe("unsupported");
    expect(report.gate).toMatchObject({ passed: false, exitCode: GATE_EXIT.unverified });
    expect(report.stacks[0]?.uninspected).toHaveLength(1);
  });

  it("keeps a failed read apart from both drift and a match", () => {
    const report = check("incomplete");
    expect(report.status).toBe("incomplete");
    expect(report.gate.exitCode).toBe(GATE_EXIT.unverified);
    expect(report.stacks[0]?.uninspected[0]?.reason).toBe("not compared: readFailed");
    expect(report.stacks[0]?.warnings).toHaveLength(1);
  });

  it("treats exit code 1 without a report as a failed run, not as drift", () => {
    const report = check("failed");
    expect(report.status).toBe("failed");
    expect(report.gate.exitCode).toBe(GATE_EXIT.failed);
  });

  it("recognizes a stack that cdkd has no state for", () => {
    expect(check("missing-target").status).toBe("missing-target");
  });

  it("notices a requested stack that is absent from the report", () => {
    const report = check("clean", ["AihBookSite", "AihSpa"]);
    expect(report.stacks.map((stack) => stack.status)).toEqual(["clean", "missing-target"]);
    expect(report.gate.passed).toBe(false);
  });

  it("does not read an empty report as a clean one", () => {
    const report = check("empty-report");
    expect(report.exitCode).toBe(0);
    expect(report.status).toBe("missing-target");
    expect(report.gate.passed).toBe(false);
  });

  it("fails when the exit code and the report disagree", () => {
    expect(check("exit-code-mismatch").status).toBe("failed");
  });

  it("refuses a request for no stacks", () => {
    expect(() => check("clean", [])).toThrow(/At least one stack/);
  });

  it("records where and when the check ran", () => {
    const report = check("clean");
    expect(report.target).toEqual({ accountId: "111111111111", region: "ap-northeast-1" });
    expect(report.executedAt).toBe("2026-10-11T12:00:00.000Z");
    expect(summarize(report)).toContain("compared and matching: 4, drifted: 0, deleted: 0, not compared: 0");
  });
});
