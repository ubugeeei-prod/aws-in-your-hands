import { type ECSClient, RunTaskCommand, type RunTaskCommandInput } from "@aws-sdk/client-ecs";
import * as v from "valibot";

import { OVERRIDES_LIMIT, RUNNER } from "./config.ts";

// #region interface
export type Launch = { runnerName: string; encodedJitConfig: string; jobId: number };
export type Launcher = { launch(request: Launch): Promise<{ taskArn: string }> };
// #endregion interface

export type Placement = {
  cluster: string;
  taskDefinition: string;
  subnets: readonly string[];
  securityGroup: string;
};

export class LaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchError";
  }
}

// #region input
/** One task, for one job. The registration is handed over as the container's arguments. */
export function runTaskInput(placement: Placement, request: Launch): RunTaskCommandInput {
  const overrides = {
    containerOverrides: [
      {
        name: RUNNER.containerName,
        command: ["--jitconfig", request.encodedJitConfig],
      },
    ],
  };
  // ECS would refuse it anyway. Refusing here says why, and before anything is started.
  const size = JSON.stringify(overrides).length;
  if (size > OVERRIDES_LIMIT) {
    throw new LaunchError(
      `the overrides are ${size} characters and RunTask allows ${OVERRIDES_LIMIT}`,
    );
  }
  return {
    cluster: placement.cluster,
    taskDefinition: placement.taskDefinition,
    launchType: "FARGATE",
    count: 1,
    // The same request sent twice by the SDK's retry starts one task, not two.
    clientToken: request.runnerName,
    startedBy: `job-${request.jobId}`,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: [...placement.subnets],
        securityGroups: [placement.securityGroup],
        // The subnets are public and have no NAT gateway: without an address the task reaches nothing.
        assignPublicIp: "ENABLED",
      },
    },
    overrides,
  };
}
// #endregion input

const resultSchema = v.object({
  tasks: v.optional(v.array(v.object({ taskArn: v.optional(v.string()) })), []),
  failures: v.optional(
    v.array(v.object({ reason: v.optional(v.string()), detail: v.optional(v.string()) })),
    [],
  ),
});

// #region ecs
export function ecsLauncher(client: Pick<ECSClient, "send">, placement: Placement): Launcher {
  return {
    async launch(request) {
      const response = await client.send(new RunTaskCommand(runTaskInput(placement, request)));
      const result = v.parse(resultSchema, response);
      const taskArn = result.tasks[0]?.taskArn;
      // RunTask answers 200 with a list of failures when no capacity or no address could be had.
      if (taskArn === undefined) {
        const [failure] = result.failures;
        throw new LaunchError(
          `RunTask started nothing: ${failure?.reason ?? "no reason given"} ${failure?.detail ?? ""}`.trim(),
        );
      }
      return { taskArn };
    },
  };
}
// #endregion ecs
