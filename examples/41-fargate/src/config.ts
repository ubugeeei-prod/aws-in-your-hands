import * as v from "valibot";

import { containersConfigSchema } from "@aih/example-12-containers/src/config.ts";

import type { StrategyItem } from "./strategy.ts";

export const REGION = "ap-northeast-1";
export const FARGATE_STACK = "AihFargate";

// #region scaling
/** How many tasks the service keeps, how far it may grow, and what it steers by. */
export const SCALING = {
  minTasks: 2,
  /** The ceiling of the bill as much as of the service. */
  maxTasks: 6,
  targetCpuPercent: 60,
  /** Requests per task per minute. An assumption until a load test replaces it. */
  targetRequestsPerTask: 600,
  /** Seconds. Going out again soon is cheap; coming in too soon is what drops capacity under load. */
  scaleOutCooldown: 60,
  scaleInCooldown: 300,
} as const;

/**
 * Where the tasks run. The base equals the minimum, so the tasks the service
 * can never go below are never on capacity that AWS may take back.
 */
export const STRATEGY: readonly StrategyItem[] = [
  { capacityProvider: "FARGATE", base: SCALING.minTasks, weight: 1 },
  { capacityProvider: "FARGATE_SPOT", weight: 3 },
];
// #endregion scaling

// #region job
/** The scheduled task: every night at 03:00 in Tokyo, on Spot, because it can be run again. */
export const JOB = {
  schedule: "cron(0 3 * * ? *)",
  timezone: "Asia/Tokyo",
  items: 20,
  /** If RunTask itself cannot be delivered: two more tries within the hour, then wait for tomorrow. */
  retryAttempts: 2,
  maxEventAgeSeconds: 3600,
} as const;
// #endregion job

// #region schema
export const fargateConfigSchema = v.object({
  // imageTag, taskSubnets, and allowedOrigin mean what they mean in chapter 12.
  ...containersConfigSchema.entries,
  // CDK context arrives as text. Anything but the two words is an error, not "false".
  exec: v.optional(
    v.pipe(
      v.picklist(["true", "false"], 'use "true" or "false"'),
      v.transform((text) => text === "true"),
    ),
    "false",
  ),
});

export type FargateConfig = v.InferOutput<typeof fargateConfigSchema>;

/** Parses CDK context (`-c imageTag=... -c exec=true`); the message names every bad field. */
export function parseFargateConfig(input: unknown): FargateConfig {
  const result = v.safeParse(fargateConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid Fargate settings:\n${problems.join("\n")}`);
  }
  return result.output;
}
// #endregion schema
