import * as v from "valibot";

import {
  isVerifiedProfileId,
  type VerifiedProfileId,
} from "@aih/example-17-ai/infra/lib/models.ts";

export const REGION = "ap-northeast-1";
export const SANDBOX_STACK = "AihAgentSandbox";
/** The one container of the task. RunTask overrides name it. */
export const CONTAINER = "agent";

// #region task
/** Claude Code's setup page asks for 4 GB of memory or more. Fargate pairs that with 1 vCPU at the least. */
export const TASK = { cpuUnits: 1024, memoryMiB: 4096 } as const;
// #endregion task

// #region limits
/** The ceilings no request can raise. Each one is the answer to a way a task can run away. */
export const LIMITS = {
  /**
   * A GitHub installation token expires an hour after it is made, and the task pushes with
   * the token it cloned with. Fifty minutes leaves ten for the launch and the push.
   */
  maxMinutes: 50,
  defaultMinutes: 30,
  /** What one task may spend on the model by the agent's own count. */
  maxJobUsd: 5,
  defaultJobUsd: 2,
  maxTurns: 80,
  /** Tasks alive at once. A loop that launches tasks is stopped here. */
  maxConcurrent: 2,
  /** What the model may cost in one UTC day, counted from CloudWatch, outside the task. */
  dailyUsd: 20,
  /** RunTask allows 8192 characters of overrides in all, the token included. */
  maxOverrideCharacters: 8192,
} as const;
// #endregion limits

/** How often the reaper looks. A task outlives its deadline by this much at the most, plus the stop timeout. */
export const REAPER_SCHEDULE = "rate(1 minute)";

const flag = v.optional(
  v.pipe(
    v.picklist(["true", "false"], 'use "true" or "false"'),
    v.transform((text) => text === "true"),
  ),
  "false",
);

// `-c repositories=acme/notes,acme/web` arrives as one string.
const commaSeparated = (value: unknown): unknown =>
  typeof value === "string"
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "")
    : value;

export const REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/;

// #region schema
export const sandboxConfigSchema = v.object({
  // Without a tag the stack is the image repository and nothing else.
  imageTag: v.optional(v.pipe(v.string(), v.regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/))),
  // The repositories a task may be started for. Empty by default: every launch is refused.
  repositories: v.optional(
    v.pipe(
      v.unknown(),
      v.transform(commaSeparated),
      v.array(v.pipe(v.string(), v.regex(REPOSITORY_PATTERN, "write owner/name"))),
      v.maxLength(20),
    ),
    [],
  ),
  // An Anthropic model, by an inference profile chapter 17 read off its model card.
  model: v.optional(
    v.pipe(
      v.string(),
      v.check(
        (id): id is VerifiedProfileId => isVerifiedProfileId(id) && id.includes(".anthropic."),
        "use an Anthropic inference profile from chapter 17's list",
      ),
      v.transform((id) => id as VerifiedProfileId),
    ),
    "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
  ),
  // The name of the secret that holds the GitHub App's key. The stack only refers to it.
  githubAppSecretName: v.optional(
    v.pipe(v.string(), v.regex(/^[A-Za-z0-9/_+=.@-]{1,200}$/)),
    "aih/agent-sandbox/github-app",
  ),
  // An interface endpoint for bedrock-runtime in the task's subnets. Billed by the hour.
  modelEndpoint: flag,
  // ECS Exec for a human. Off unless asked for: it gives the task four more actions.
  exec: flag,
});

export type SandboxConfig = v.InferOutput<typeof sandboxConfigSchema>;

/** Parses CDK context (`-c imageTag=... -c repositories=owner/name`); the message names every bad field. */
export function parseSandboxConfig(input: unknown): SandboxConfig {
  const result = v.safeParse(sandboxConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid agent sandbox settings:\n${problems.join("\n")}`);
  }
  return result.output;
}
// #endregion schema
