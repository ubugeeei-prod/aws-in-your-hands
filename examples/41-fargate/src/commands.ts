// The AWS CLI calls this chapter asks the reader to make, as data. The scripts
// run them; the tests read them.

export type Command = { title: string; command: string[] };

export type StackOutputs = {
  region: string;
  cluster: string;
  service: string;
  jobTaskDefinition: string;
  subnets: string[];
  securityGroup: string;
  assignPublicIp: "ENABLED" | "DISABLED";
};

const network = (outputs: StackOutputs): string =>
  `awsvpcConfiguration={subnets=[${outputs.subnets.join(",")}],securityGroups=[${outputs.securityGroup}],assignPublicIp=${outputs.assignPublicIp}}`;

// #region run-task
export type RunOverrides = {
  /** Environment variables for this run only, for example JOB_START_AT after an interruption. */
  environment: Record<string, string>;
  /** On-demand for a run that must not be interrupted; Spot otherwise. */
  capacityProvider: "FARGATE" | "FARGATE_SPOT";
  /** Names the run. A second call with the same token and arguments starts nothing new. */
  clientToken: string;
};

/** One run of the job's task definition, with this run's settings laid over it. */
export function runTaskCommand(outputs: StackOutputs, overrides: RunOverrides): Command {
  const containerOverrides = [
    {
      name: "job",
      environment: Object.entries(overrides.environment).map(([name, value]) => ({ name, value })),
    },
  ];
  return {
    title: "start one task from the job's task definition",
    command: [
      "aws",
      "ecs",
      "run-task",
      "--region",
      outputs.region,
      "--cluster",
      outputs.cluster,
      "--task-definition",
      outputs.jobTaskDefinition,
      "--count",
      "1",
      // A launch type and a capacity provider strategy exclude each other.
      "--capacity-provider-strategy",
      `capacityProvider=${overrides.capacityProvider},weight=1`,
      "--network-configuration",
      network(outputs),
      "--overrides",
      JSON.stringify({ containerOverrides }),
      "--client-token",
      overrides.clientToken,
      "--started-by",
      "aih-fargate-run",
      "--query",
      "{task: tasks[0].taskArn, failures: failures}",
    ],
  };
}
// #endregion run-task

// #region exec
/** A shell in a running task of the service. Works only if the stack was deployed with `-c exec=true`. */
export function execCommand(outputs: StackOutputs, taskId: string): Command {
  if (!/^[0-9a-f]{32}$/.test(taskId)) {
    throw new Error("the task ID is the 32 hexadecimal characters at the end of the task ARN");
  }
  return {
    title: "open a shell in the api container (logged; ends after 20 idle minutes)",
    command: [
      "aws",
      "ecs",
      "execute-command",
      "--region",
      outputs.region,
      "--cluster",
      outputs.cluster,
      "--task",
      taskId,
      "--container",
      "api",
      "--interactive",
      "--command",
      "/bin/sh",
    ],
  };
}
// #endregion exec

export const render = (command: Command): string =>
  command.command.map((part) => (/[\s"{}[\]]/.test(part) ? `'${part}'` : part)).join(" ");
