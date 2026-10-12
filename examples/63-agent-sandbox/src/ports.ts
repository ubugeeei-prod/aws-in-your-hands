import type { VerifiedProfileId } from "@aih/example-17-ai/infra/lib/models.ts";

import type { GithubApp, HttpRequest } from "./github.ts";
import type { LaunchPlan, RunTaskOverrides } from "./job.ts";
import type { RunningTask, Tokens } from "./limits.ts";

// #region ports
/** Everything the two functions ask of the outside world. Tests hand in fakes; src/aws.ts is the real one. */
export type Ports = {
  now: () => Date;
  /** Tasks of the sandbox's cluster that are not stopped. */
  runningTasks: () => Promise<RunningTask[]>;
  /** Sums of the account's Bedrock token metrics since `since`. */
  tokensSince: (since: Date, now: Date) => Promise<Tokens>;
  githubApp: () => Promise<GithubApp>;
  http: (request: HttpRequest) => Promise<{ status: number; body: unknown }>;
  runTask: (plan: LaunchPlan, overrides: RunTaskOverrides) => Promise<RunTaskResult>;
  stopTask: (taskArn: string, reason: string) => Promise<void>;
};

export type RunTaskResult =
  | { taskArn: string }
  /** RunTask knew the client token: an earlier call with it already started these tasks. */
  | { conflict: string[] }
  | { failure: string };

export type Settings = { allowedRepositories: readonly string[]; model: VerifiedProfileId };
// #endregion ports
