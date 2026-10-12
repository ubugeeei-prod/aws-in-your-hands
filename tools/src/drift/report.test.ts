import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { buildReport, GATE_EXIT, type RunResult, summarize } from "./report.ts";

const fixture = (name: string): RunResult =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as RunResult;

const check = (name: string, requestedStacks = ["AihBookSite"]) =>
  buildReport({
    requestedStacks,
    run: fixture(name),
    target: { accountId: "111111111111", region: "ap-northeast-1" },
    executedAt: new Date("2026-10-11T12:00:00Z"),
    toolVersion: "0.296.28",
  });

describe("drift report", () => {
  it("passes only when everything was compared and matches", () => {
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
      {
        logicalId: "Distribution",
        type: "AWS::CloudFront::Distribution",
        paths: ["DistributionConfig.Comment"],
      },
    ]);
  });

  it("reports a deleted resource", () => {
    const report = check("deleted");
    expect(report.status).toBe("deleted");
    expect(report.gate.exitCode).toBe(GATE_EXIT.differs);
  });

  it("unreadable type is not in sync", () => {
    // cdkd exits 0 here, but one resource was never looked at.
    const report = check("unsupported");
    expect(report.exitCode).toBe(0);
    expect(report.status).toBe("unsupported");
    expect(report.gate).toMatchObject({ passed: false, exitCode: GATE_EXIT.unverified });
    expect(report.stacks[0]?.uninspected).toHaveLength(1);
  });

  it("failed read is neither drift nor a match", () => {
    const report = check("incomplete");
    expect(report.status).toBe("incomplete");
    expect(report.gate.exitCode).toBe(GATE_EXIT.unverified);
    expect(report.stacks[0]?.uninspected[0]?.reason).toBe("not compared: readFailed");
    expect(report.stacks[0]?.warnings).toHaveLength(1);
  });

  it("exit 1 without a report is a failed run, not drift", () => {
    const report = check("failed");
    expect(report.status).toBe("failed");
    expect(report.gate.exitCode).toBe(GATE_EXIT.failed);
  });

  it("stack without state is missing-target", () => {
    expect(check("missing-target").status).toBe("missing-target");
  });

  it("requested stack absent from the report is missing-target", () => {
    const report = check("clean", ["AihBookSite", "AihSpa"]);
    expect(report.stacks.map((stack) => stack.status)).toEqual(["clean", "missing-target"]);
    expect(report.gate.passed).toBe(false);
  });

  it("empty report is not clean", () => {
    const report = check("empty-report");
    expect(report.exitCode).toBe(0);
    expect(report.status).toBe("missing-target");
    expect(report.gate.passed).toBe(false);
  });

  it("exit code and report must agree", () => {
    expect(check("exit-code-mismatch").status).toBe("failed");
  });

  it("refuses a request for no stacks", () => {
    expect(() => check("clean", [])).toThrow(/At least one stack/);
  });

  it("records where and when the check ran", () => {
    const report = check("clean");
    expect(report.target).toEqual({ accountId: "111111111111", region: "ap-northeast-1" });
    expect(report.executedAt).toBe("2026-10-11T12:00:00.000Z");
    expect(summarize(report)).toContain(
      "compared and matching: 4, drifted: 0, deleted: 0, not compared: 0",
    );
  });

  it("fails when cdkd says some resources were not compared but lists none", () => {
    const run = { ...fixture("clean"), exitCode: 2 };
    const report = buildReport({
      requestedStacks: ["AihBookSite"],
      run,
      target: { accountId: "111111111111", region: "ap-northeast-1" },
      executedAt: new Date("2026-10-11T12:00:00Z"),
      toolVersion: "0.296.28",
    });
    expect(report.status).toBe("failed");
  });
});
