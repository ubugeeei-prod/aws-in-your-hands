// vp run fargate:job:run [--start-at 12] [--on-demand] [--token name] [--dry-run]
// vp run fargate:exec <task id> [--dry-run]
//   node scripts/task.ts <run|exec> ...
//
// run:  starts the job's task definition once, with this run's settings laid over it.
// exec: opens a shell in a task of the service. Needs a stack deployed with -c exec=true,
//       and the Session Manager plugin for the AWS CLI on this machine.
// --dry-run prints the AWS CLI command with placeholder IDs and calls nothing.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import {
  type Command,
  execCommand,
  render,
  runTaskCommand,
  type StackOutputs,
} from "../src/commands.ts";
import { FARGATE_STACK, REGION } from "../src/config.ts";

const { values, positionals } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "start-at": { type: "string" },
    "on-demand": { type: "boolean", default: false },
    token: { type: "string" },
  },
  allowPositionals: true,
});
const [action, taskId] = positionals;

const PLACEHOLDERS: StackOutputs = {
  region: REGION,
  cluster: "cluster-name",
  service: "service-name",
  jobTaskDefinition: "arn:aws:ecs:ap-northeast-1:123456789012:task-definition/job-family:1",
  subnets: ["subnet-11111111", "subnet-22222222"],
  securityGroup: "sg-11111111",
  assignPublicIp: "ENABLED",
};

async function outputs(description: string): Promise<StackOutputs> {
  if (values["dry-run"]) {
    console.error("# the IDs below are placeholders; a real run reads them from the stack");
    return PLACEHOLDERS;
  }
  const { target } = await preflight({
    access: "mutate",
    action: description,
    stack: FARGATE_STACK,
  });
  const read = await readStackOutputs(process.cwd(), FARGATE_STACK, target.region);
  const subnets = requireOutput(read, "TaskSubnetIds").split(",");
  return {
    region: target.region,
    cluster: requireOutput(read, "ClusterName"),
    service: requireOutput(read, "ServiceName"),
    jobTaskDefinition: requireOutput(read, "JobTaskDefinitionArn"),
    subnets,
    securityGroup: requireOutput(read, "TaskSecurityGroupId"),
    // The stack gives tasks a public address exactly when it puts them in the public subnets.
    assignPublicIp: requireOutput(read, "TaskPublicIp") === "ENABLED" ? "ENABLED" : "DISABLED",
  };
}

try {
  let command: Command;
  if (action === "run") {
    const startAt = values["start-at"];
    if (startAt !== undefined && !/^\d+$/.test(startAt)) {
      throw new Error("--start-at takes the `next` number an interrupted run logged");
    }
    command = runTaskCommand(await outputs("start one run of the job"), {
      environment: startAt === undefined ? {} : { JOB_START_AT: startAt },
      capacityProvider: values["on-demand"] ? "FARGATE" : "FARGATE_SPOT",
      // One token per minute: running the command twice by accident starts one task.
      clientToken:
        values.token ?? `aih-${new Date().toISOString().slice(0, 16).replaceAll(/\D/g, "")}`,
    });
  } else if (action === "exec" && taskId !== undefined) {
    command = execCommand(await outputs("open a shell in a running task"), taskId);
  } else {
    throw new Error(
      "usage: task.ts run [--start-at n] [--on-demand] [--token name] | exec <task id>",
    );
  }

  console.error(`# ${command.title}\n$ ${render(command)}`);
  if (!values["dry-run"]) {
    const [program = "", ...args] = command.command;
    const result = spawnSync(program, args, { stdio: "inherit" });
    process.exit(result.status ?? 1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
