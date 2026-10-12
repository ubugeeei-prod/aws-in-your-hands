import { readFileSync } from "node:fs";

import {
  type CloudFormationClient,
  DescribeStackDriftDetectionStatusCommand,
  DescribeStackResourceDriftsCommand,
  DetectStackDriftCommand,
  ListStackResourcesCommand,
} from "@aws-sdk/client-cloudformation";
import { describe, expect, it } from "vite-plus/test";

import { buildCfnReport, detectStackDrift } from "@aih/tools/drift/cloudformation.ts";

import { cfnDriftApi } from "../src/drift-client.ts";
import { ACKNOWLEDGED_UNCHECKED_TYPES } from "../src/drift-coverage.ts";

type Fixture = {
  detect: unknown;
  statuses: unknown[];
  driftPages: unknown[];
  resourcePages: unknown[];
};
const fixture = (name: string): Fixture =>
  JSON.parse(
    readFileSync(
      new URL(`../../../tools/src/drift/fixtures/cloudformation/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as Fixture;

/** Stands in for CloudFormationClient: answers by command class and keeps what it was sent. */
function fakeClient(data: Fixture) {
  const sent: { command: string; input: unknown }[] = [];
  let polls = 0;
  const pageOf = (pages: unknown[], token: string | undefined) =>
    pages[token === undefined ? 0 : Number(token.replace("page-", "")) - 1];
  const send = async (command: { input: unknown }) => {
    sent.push({ command: command.constructor.name, input: command.input });
    if (command instanceof DetectStackDriftCommand) {
      return data.detect;
    }
    if (command instanceof DescribeStackDriftDetectionStatusCommand) {
      polls += 1;
      return data.statuses[Math.min(polls - 1, data.statuses.length - 1)];
    }
    if (command instanceof DescribeStackResourceDriftsCommand) {
      return pageOf(data.driftPages, command.input.NextToken);
    }
    if (command instanceof ListStackResourcesCommand) {
      return pageOf(data.resourcePages, command.input.NextToken);
    }
    throw new Error(`unexpected command ${command.constructor.name}`);
  };
  return { client: { send } as unknown as Pick<CloudFormationClient, "send">, sent };
}

const run = async (name: string) => {
  const { client, sent } = fakeClient(fixture(name));
  const outcome = await detectStackDrift({
    stack: "AihShipApi",
    api: cfnDriftApi(client),
    polling: { intervalMs: 0, maxAttempts: 5 },
    sleep: async () => {},
  });
  const report = buildCfnReport({
    stack: "AihShipApi",
    outcome,
    target: { accountId: "111111111111", region: "ap-northeast-1" },
    executedAt: new Date("2026-10-11T12:01:00Z"),
    toolVersion: "test",
    acknowledgedTypes: [...ACKNOWLEDGED_UNCHECKED_TYPES],
  });
  return { report, sent };
};

describe("CloudFormation drift through the SDK client", () => {
  it("sends the three documented calls in order, then reads the stack's resource list", async () => {
    const { report, sent } = await run("clean");
    expect(sent.map((call) => call.command)).toEqual([
      "DetectStackDriftCommand",
      "DescribeStackDriftDetectionStatusCommand",
      "DescribeStackDriftDetectionStatusCommand",
      "DescribeStackDriftDetectionStatusCommand",
      "DescribeStackResourceDriftsCommand",
      "DescribeStackResourceDriftsCommand",
      "ListStackResourcesCommand",
    ]);
    expect(sent[0]?.input).toEqual({ StackName: "AihShipApi" });
    // The ID returned by the first call, not the stack name, identifies the run being polled.
    expect(sent[1]?.input).toEqual({
      StackDriftDetectionId: "11111111-2222-4333-8444-555555555555",
    });
    // No status filter: unfiltered results are what "checked" is counted from.
    expect(sent[4]?.input).toEqual({ StackName: "AihShipApi", NextToken: undefined });
    expect(sent[5]?.input).toEqual({ StackName: "AihShipApi", NextToken: "page-2" });
    expect(report.status).toBe("clean");
    expect(report.acknowledged.exitCode).toBe(0);
  });

  it("the integration this stack cannot have checked is acknowledged, and still reported", async () => {
    const { report } = await run("not-checked");
    expect(report.status).toBe("unsupported");
    expect(report.gate.passed).toBe(false);
    expect(report.acknowledged).toMatchObject({
      exitCode: 0,
      types: ["AWS::ApiGatewayV2::Integration"],
    });
  });

  it("an acknowledged gap never hides drift", async () => {
    const { report } = await run("drifted");
    expect(report.acknowledged.exitCode).toBe(10);
  });
});
