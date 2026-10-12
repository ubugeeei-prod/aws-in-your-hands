import { describe, expect, it } from "vite-plus/test";

import { execCommand, render, runTaskCommand, type StackOutputs } from "../src/commands.ts";

const outputs: StackOutputs = {
  region: "ap-northeast-1",
  cluster: "cluster-name",
  service: "service-name",
  jobTaskDefinition: "arn:aws:ecs:ap-northeast-1:123456789012:task-definition/job:3",
  subnets: ["subnet-1", "subnet-2"],
  securityGroup: "sg-1",
  assignPublicIp: "ENABLED",
};
const after = (command: string[], flag: string): string | undefined =>
  command[command.indexOf(flag) + 1];

describe("runTaskCommand", () => {
  const { command } = runTaskCommand(outputs, {
    environment: { JOB_START_AT: "7" },
    capacityProvider: "FARGATE_SPOT",
    clientToken: "resume-7",
  });

  it("lays this run's settings over the task definition without registering a new one", () => {
    expect(after(command, "--task-definition")).toBe(outputs.jobTaskDefinition);
    expect(JSON.parse(after(command, "--overrides") ?? "")).toEqual({
      containerOverrides: [{ name: "job", environment: [{ name: "JOB_START_AT", value: "7" }] }],
    });
  });

  it("names a capacity provider and no launch type, and the network of the stack", () => {
    expect(command).not.toContain("--launch-type");
    expect(after(command, "--capacity-provider-strategy")).toBe(
      "capacityProvider=FARGATE_SPOT,weight=1",
    );
    expect(after(command, "--network-configuration")).toBe(
      "awsvpcConfiguration={subnets=[subnet-1,subnet-2],securityGroups=[sg-1],assignPublicIp=ENABLED}",
    );
  });

  it("carries a token, so that the same call made twice starts one task", () => {
    expect(after(command, "--client-token")).toBe("resume-7");
    expect(after(command, "--count")).toBe("1");
  });

  it("never switches on ECS Exec for a one-off task", () => {
    expect(command).not.toContain("--enable-execute-command");
  });
});

describe("execCommand", () => {
  it("opens an interactive shell in the api container of one task", () => {
    const { command } = execCommand(outputs, "0123456789abcdef0123456789abcdef");
    expect(command.slice(0, 3)).toEqual(["aws", "ecs", "execute-command"]);
    expect(after(command, "--container")).toBe("api");
    expect(command).toContain("--interactive");
    expect(after(command, "--command")).toBe("/bin/sh");
  });

  it("refuses anything that is not a task ID, so no shell text reaches the command line", () => {
    expect(() => execCommand(outputs, "abc; rm -rf /")).toThrow(/task ID/);
    expect(() => execCommand(outputs, "arn:aws:ecs:ap-northeast-1:1:task/c/0123")).toThrow();
  });
});

describe("render", () => {
  it("quotes the parts a shell would split or expand", () => {
    expect(render({ title: "", command: ["aws", "--overrides", '{"a": 1}'] })).toBe(
      `aws --overrides '{"a": 1}'`,
    );
  });
});
