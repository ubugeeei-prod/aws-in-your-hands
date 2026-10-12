import { PLATFORM, type Step } from "@aih/example-12-containers/src/image.ts";

/** Name of the image on this machine, before it is tagged for the repository. */
export const LOCAL_IMAGE = "aih-isolates";

// #region steps
export const buildSteps = (tag: string): Step[] => [
  {
    title: "build the image",
    command: ["docker", "build", "--platform", PLATFORM, "--tag", `${LOCAL_IMAGE}:${tag}`, "."],
  },
];

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
