import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  acknowledge,
  buildCfnReport,
  type CfnDriftApi,
  detectStackDrift,
  type Polling,
  summarizeCfn,
} from "./cloudformation.ts";
import { GATE_EXIT } from "./report.ts";

type Fixture = {
  detect?: unknown;
  detectError?: { name: string; message: string };
  statuses: unknown[];
  driftPages: unknown[];
  resourcePages: unknown[];
};

const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/cloudformation/${name}.json`, import.meta.url), "utf8")) as Fixture;

/** Answers the four calls from a fixture and records the order they were made in. */
function scripted(data: Fixture, overrides: Partial<CfnDriftApi> = {}) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  let polls = 0;
  const page = (pages: unknown[], nextToken: string | undefined) =>
    pages[nextToken === undefined ? 0 : Number(nextToken.replace("page-", "")) - 1];
  const api: CfnDriftApi = {
    async detectStackDrift(stack) {
      calls.push(`detect ${stack}`);
      if (data.detectError !== undefined) {
        throw Object.assign(new Error(data.detectError.message), { name: data.detectError.name });
      }
      return data.detect;
    },
    async describeDetectionStatus(detectionId) {
      calls.push(`status ${detectionId}`);
      const status = data.statuses[Math.min(polls, data.statuses.length - 1)];
      polls += 1;
      return status;
    },
    async describeResourceDrifts(_stack, nextToken) {
      calls.push(`drifts ${nextToken ?? "first"}`);
      return page(data.driftPages, nextToken);
    },
    async listStackResources(_stack, nextToken) {
      calls.push(`resources ${nextToken ?? "first"}`);
      return page(data.resourcePages, nextToken);
    },
    ...overrides,
  };
  return { api, calls, sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
}

const POLLING: Polling = { intervalMs: 5000, maxAttempts: 5 };

async function check(name: string, options: { acknowledgedTypes?: string[]; overrides?: Partial<CfnDriftApi> } = {}) {
  const run = scripted(fixture(name), options.overrides);
  const outcome = await detectStackDrift({ stack: "AihShipApi", api: run.api, polling: POLLING, sleep: run.sleep });
  const report = buildCfnReport({
    stack: "AihShipApi",
    outcome,
    target: { accountId: "111111111111", region: "ap-northeast-1" },
    executedAt: new Date("2026-10-11T12:01:00Z"),
    toolVersion: "sdk 3.1149.0",
    acknowledgedTypes: options.acknowledgedTypes ?? [],
  });
  return { ...run, outcome, report, stack: report.stacks[0] };
}

describe("CloudFormation drift report", () => {
  it("passes only when every resource in the stack was checked and matches", async () => {
    const { report, stack, calls, sleeps } = await check("clean");
    expect(report.status).toBe("clean");
    expect(report.gate).toMatchObject({ passed: true, exitCode: GATE_EXIT.clean });
    expect(stack?.counts).toEqual({ clean: 4, drifted: 0, deleted: 0, uninspected: 0 });
    // Polled until complete, waiting only between attempts, then read every page.
    expect(calls.filter((call) => call.startsWith("status"))).toHaveLength(3);
    expect(sleeps).toEqual([5000, 5000]);
    expect(calls.slice(-3)).toEqual(["drifts first", "drifts page-2", "resources first"]);
  });

  it("names the drifted property and keeps property values out of the report", async () => {
    const { report, stack } = await check("drifted");
    expect(report.status).toBe("drifted");
    expect(report.gate.exitCode).toBe(GATE_EXIT.differs);
    expect(stack?.drifted).toEqual([{ logicalId: "Handler", type: "AWS::Lambda::Function", paths: ["/MemorySize"] }]);
    expect(JSON.stringify(report)).not.toContain("1024");
  });

  it("reports a resource deleted outside CloudFormation", async () => {
    const { report, stack } = await check("deleted");
    expect(report.status).toBe("deleted");
    expect(report.gate.exitCode).toBe(GATE_EXIT.differs);
    expect(stack?.deleted).toEqual([{ logicalId: "ApiDefaultStage", type: "AWS::ApiGatewayV2::Stage" }]);
  });

  it("IN_SYNC with an unchecked resource is not clean", async () => {
    // CloudFormation's answer is IN_SYNC here: it covers only what was checked.
    const { report, stack } = await check("not-checked");
    expect(report.status).toBe("unsupported");
    expect(report.gate).toMatchObject({ passed: false, exitCode: GATE_EXIT.unverified });
    expect(stack?.uninspected.map((r) => r.type)).toEqual(["AWS::ApiGatewayV2::Integration"]);
    expect(stack?.counts).toEqual({ clean: 4, drifted: 0, deleted: 0, uninspected: 1 });
  });

  it("a nested stack is left unexamined, and says so", async () => {
    const { report, stack } = await check("nested-stack");
    expect(report.status).toBe("incomplete");
    expect(report.gate.exitCode).toBe(GATE_EXIT.unverified);
    expect(stack?.uninspected[0]).toMatchObject({ logicalId: "Storage", type: "AWS::CloudFormation::Stack" });
  });

  it("DETECTION_FAILED is failed even when the other resources match", async () => {
    const { report, stack } = await check("detection-failed");
    expect(report.status).toBe("failed");
    expect(report.gate.exitCode).toBe(GATE_EXIT.failed);
    expect(stack?.detail).toContain("Failed to detect drift on resource [HandlerRole]");
    expect(stack?.uninspected[0]?.reason).toContain("iam:GetRole");
  });

  it("a resource that could not be evaluated is neither drift nor a match", async () => {
    const { report, stack } = await check("unknown-resource");
    expect(report.status).toBe("incomplete");
    expect(stack?.counts.uninspected).toBe(1);
  });

  it("a stack that does not exist is missing-target", async () => {
    const { report, calls } = await check("missing-stack");
    expect(report.status).toBe("missing-target");
    expect(report.gate.exitCode).toBe(GATE_EXIT.failed);
    expect(calls).toEqual(["detect AihShipApi"]);
  });

  it("gives up after the attempt limit without reading older results", async () => {
    const { report, outcome, calls, sleeps } = await check("in-progress");
    expect(outcome).toMatchObject({ kind: "timeout", attempts: 5 });
    expect(report.status).toBe("failed");
    expect(report.gate.exitCode).toBe(GATE_EXIT.failed);
    expect(sleeps).toEqual([5000, 5000, 5000, 5000]);
    // The fixture has IN_SYNC results from an earlier run. They must not be read.
    expect(calls.some((call) => call.startsWith("drifts"))).toBe(false);
  });

  it("a result older than this detection does not count as checked", async () => {
    const { report, stack } = await check("stale-result");
    expect(report.status).toBe("incomplete");
    expect(stack?.counts).toEqual({ clean: 3, drifted: 0, deleted: 0, uninspected: 1 });
    expect(stack?.uninspected[0]?.reason).toContain("stale result");
  });

  it("stack status and resource results must agree", async () => {
    const { report } = await check("inconsistent");
    expect(report.status).toBe("failed");
    expect(report.gate.exitCode).toBe(GATE_EXIT.failed);
  });

  it("a response of an unexpected shape is failed, not clean", async () => {
    const { report, outcome } = await check("malformed");
    expect(outcome).toMatchObject({ kind: "error", step: "poll" });
    expect(report.status).toBe("failed");
  });

  it.each([
    ["describeDetectionStatus", "poll"],
    ["describeResourceDrifts", "results"],
    ["listStackResources", "inventory"],
  ] as const)("an error from %s is failed", async (method, step) => {
    const throttled = async () => {
      throw Object.assign(new Error("Rate exceeded"), { name: "Throttling" });
    };
    const { report, outcome } = await check("clean", { overrides: { [method]: throttled } });
    expect(outcome).toMatchObject({ kind: "error", step });
    expect(report.status).toBe("failed");
    expect(report.exitCode).toBe(1);
  });

  it("an error other than a missing stack at the start is failed", async () => {
    const denied = async () => {
      throw Object.assign(new Error("not authorized to perform: cloudformation:DetectStackDrift"), {
        name: "AccessDenied",
      });
    };
    const { report } = await check("clean", { overrides: { detectStackDrift: denied } });
    expect(report.status).toBe("failed");
  });

  it("rejects polling settings that could never observe a result", async () => {
    const run = scripted(fixture("clean"));
    await expect(
      detectStackDrift({
        stack: "AihShipApi",
        api: run.api,
        polling: { intervalMs: 1, maxAttempts: 0 },
        sleep: run.sleep,
      }),
    ).rejects.toThrow("maxAttempts");
    expect(run.calls).toEqual([]);
  });
});

describe("acknowledged gaps", () => {
  it("exit 0 only when every unchecked resource is of an acknowledged type", async () => {
    const { report } = await check("not-checked", { acknowledgedTypes: ["AWS::ApiGatewayV2::Integration"] });
    // The status and the gate do not change. Only the exit code the task returns does.
    expect(report.status).toBe("unsupported");
    expect(report.gate.exitCode).toBe(GATE_EXIT.unverified);
    expect(report.acknowledged.exitCode).toBe(0);
    expect(summarizeCfn(report)).toContain("not the same as in sync");
  });

  it("an unchecked type that nobody acknowledged still fails", async () => {
    const { report } = await check("not-checked", { acknowledgedTypes: ["AWS::CDK::Metadata"] });
    expect(report.acknowledged.exitCode).toBe(GATE_EXIT.unverified);
    expect(report.acknowledged.note).toContain("AWS::ApiGatewayV2::Integration");
  });

  it.each(["drifted", "deleted", "nested-stack", "stale-result", "detection-failed", "in-progress"])(
    "never excuses %s",
    async (name) => {
      const { report, stack } = await check(name, {
        acknowledgedTypes: ["AWS::ApiGatewayV2::Stage", "AWS::CloudFormation::Stack", "AWS::Lambda::Function"],
      });
      expect(report.acknowledged.exitCode).toBe(report.gate.exitCode);
      expect(report.acknowledged.exitCode).not.toBe(0);
      expect(stack === undefined ? null : acknowledge(stack, []).exitCode).toBe(report.gate.exitCode);
    },
  );
});
