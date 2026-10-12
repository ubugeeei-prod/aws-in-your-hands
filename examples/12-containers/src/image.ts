import { TASK } from "./config.ts";

/** Name of the image on this machine, before it is tagged for the repository. */
export const LOCAL_IMAGE = "aih-notes";

export type Step = {
  title: string;
  command: string[];
  /** A command whose output is piped into `command`, so that a password never appears in an argument. */
  input?: string[];
};

// #region steps
/** Fargate runs this task definition on arm64, so the image is built for it wherever the build runs. */
export const PLATFORM = "linux/arm64";

export function buildSteps(tag: string): Step[] {
  return [
    {
      title: "build the image",
      command: ["docker", "build", "--platform", PLATFORM, "--tag", `${LOCAL_IMAGE}:${tag}`, "."],
    },
  ];
}

export function runSteps(tag: string): Step[] {
  const port = String(TASK.containerPort);
  return [
    {
      title: `run it on http://localhost:${port} (Ctrl-C sends SIGINT, which the server treats like SIGTERM)`,
      command: [
        "docker",
        "run",
        "--rm",
        // The same restriction the task definition sets.
        "--read-only",
        "--publish",
        `${port}:${port}`,
        "--env",
        "ALLOWED_ORIGIN=http://localhost:5173",
        "--env",
        `APP_VERSION=${tag}`,
        `${LOCAL_IMAGE}:${tag}`,
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
      title: "log Docker in to the registry (the token lasts 12 hours)",
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
// #endregion steps

export const render = (step: Step): string =>
  step.input === undefined
    ? step.command.join(" ")
    : `${step.input.join(" ")} | ${step.command.join(" ")}`;
