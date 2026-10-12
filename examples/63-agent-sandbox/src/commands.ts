// The docker and AWS CLI calls this chapter asks the reader to make, as data. The script
// runs them; the tests read them.

import { CONTAINER } from "./config.ts";

export type Step = {
  title: string;
  command: string[];
  /** A command whose output is piped into `command`, so that a password never appears in an argument. */
  input?: string[];
};

const LOCAL_IMAGE = "aih-agent-sandbox";

// #region image
export function buildSteps(tag: string): Step[] {
  return [
    {
      title: "build the image for arm64, which is what the task definition asks for",
      command: [
        "docker",
        "build",
        "--platform",
        "linux/arm64",
        "--tag",
        `${LOCAL_IMAGE}:${tag}`,
        ".",
      ],
    },
  ];
}

export function pushSteps(tag: string, repositoryUri: string, region: string): Step[] {
  const registry = repositoryUri.split("/")[0];
  if (registry === undefined || !/^\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com$/.test(registry)) {
    throw new Error(`"${repositoryUri}" does not look like the URI of an ECR repository`);
  }
  const remote = `${repositoryUri}:${tag}`;
  return [
    {
      title: "log Docker in to the registry",
      input: ["aws", "ecr", "get-login-password", "--region", region],
      command: ["docker", "login", "--username", "AWS", "--password-stdin", registry],
    },
    {
      title: "name the image after the repository",
      command: ["docker", "tag", `${LOCAL_IMAGE}:${tag}`, remote],
    },
    { title: "push it", command: ["docker", "push", remote] },
  ];
}
// #endregion image

// #region launch
export type LaunchInput = {
  requestId: string;
  repository: string;
  task: string;
  baseBranch?: string;
  minutes?: number;
  budgetUsd?: number;
};

/** Invokes the launcher. Whoever runs this needs lambda:InvokeFunction on that one function. */
export function launchSteps(functionName: string, region: string, request: LaunchInput): Step[] {
  return [
    {
      title: "ask the launcher for one task",
      command: [
        "aws",
        "lambda",
        "invoke",
        "--region",
        region,
        "--function-name",
        functionName,
        "--cli-binary-format",
        "raw-in-base64-out",
        "--payload",
        JSON.stringify(request),
        "/dev/stdout",
      ],
    },
  ];
}
// #endregion launch

// #region watch
export function logSteps(logGroup: string, region: string): Step[] {
  return [
    {
      title: "follow what the tasks print: the agent's stream, one JSON object per line",
      command: ["aws", "logs", "tail", logGroup, "--region", region, "--follow", "--since", "1h"],
    },
  ];
}

/** A shell in a running task. Works only on a stack deployed with -c exec=true. */
export function execSteps(cluster: string, region: string, taskId: string): Step[] {
  return [
    {
      title: "open a shell in the task (recorded by CloudTrail as ExecuteCommand)",
      command: [
        "aws",
        "ecs",
        "execute-command",
        "--region",
        region,
        "--cluster",
        cluster,
        "--task",
        taskId,
        "--container",
        CONTAINER,
        "--interactive",
        "--command",
        "/bin/sh",
      ],
    },
  ];
}
// #endregion watch

const quote = (arg: string): string =>
  /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;

export const render = (step: Step): string =>
  step.input === undefined
    ? step.command.map(quote).join(" ")
    : `${step.input.map(quote).join(" ")} | ${step.command.map(quote).join(" ")}`;
