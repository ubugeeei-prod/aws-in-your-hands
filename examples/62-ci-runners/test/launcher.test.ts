import { describe, expect, it } from "vite-plus/test";

import { OVERRIDES_LIMIT, RUNNER } from "../src/config.ts";
import { ecsLauncher, LaunchError, type Placement, runTaskInput } from "../src/launcher.ts";

const placement: Placement = {
  cluster: "arn:aws:ecs:ap-northeast-1:111122223333:cluster/c",
  taskDefinition: "arn:aws:ecs:ap-northeast-1:111122223333:task-definition/runner:3",
  subnets: ["subnet-a", "subnet-b"],
  securityGroup: "sg-1",
};
const request = { runnerName: "aih-7-a1", encodedJitConfig: "abc", jobId: 7 };

describe("the RunTask request", () => {
  it("starts one on-demand Fargate task and hands the registration over as arguments", () => {
    const input = runTaskInput(placement, request);
    expect(input).toMatchObject({
      launchType: "FARGATE",
      count: 1,
      clientToken: "aih-7-a1",
      startedBy: "job-7",
      overrides: {
        containerOverrides: [{ name: RUNNER.containerName, command: ["--jitconfig", "abc"] }],
      },
    });
    expect(input.networkConfiguration?.awsvpcConfiguration).toEqual({
      subnets: ["subnet-a", "subnet-b"],
      securityGroups: ["sg-1"],
      assignPublicIp: "ENABLED",
    });
  });

  it("overrides neither role, so the task runs with the empty one from the task definition", () => {
    const { overrides } = runTaskInput(placement, request);
    expect(overrides).not.toHaveProperty("taskRoleArn");
    expect(overrides).not.toHaveProperty("executionRoleArn");
  });

  it("refuses a registration too long for the overrides, before calling ECS", () => {
    const long = { ...request, encodedJitConfig: "x".repeat(OVERRIDES_LIMIT) };
    expect(() => runTaskInput(placement, long)).toThrow(LaunchError);
  });
});

describe("the ECS launcher", () => {
  it("returns the task's ARN", async () => {
    const launcher = ecsLauncher(
      { send: async () => ({ tasks: [{ taskArn: "arn:task/1" }], failures: [] }) } as never,
      placement,
    );
    expect(await launcher.launch(request)).toEqual({ taskArn: "arn:task/1" });
  });

  it("treats an answer with no task as a failure, although the call succeeded", async () => {
    const launcher = ecsLauncher(
      { send: async () => ({ tasks: [], failures: [{ reason: "RESOURCE:ENI" }] }) } as never,
      placement,
    );
    await expect(launcher.launch(request)).rejects.toThrow(/RESOURCE:ENI/);
  });
});
