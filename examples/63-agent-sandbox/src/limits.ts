import type { VerifiedProfileId } from "@aih/example-17-ai/infra/lib/models.ts";
import { profileOf } from "@aih/example-36-bedrock/src/models.ts";

import { LIMITS } from "./config.ts";
import { parseStartedBy } from "./job.ts";

// #region spend
/** Sums of the AWS/Bedrock token metrics since 00:00 UTC, with no dimension: the whole account. */
export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

/**
 * What those tokens cost at the pinned model's list price. An estimate from outside the task:
 * it is late by the metrics' delay, and every token in the account is priced as this model's.
 */
export function estimateUsd(tokens: Tokens, model: VerifiedProfileId): number {
  const usd = profileOf(model).usdPerMillionTokens;
  return (
    (tokens.input * usd.input +
      tokens.output * usd.output +
      tokens.cacheRead * usd.cacheRead +
      tokens.cacheWrite * usd.cacheWrite) /
    1_000_000
  );
}
// #endregion spend

// #region reap
export type RunningTask = { taskArn: string; startedBy: string | undefined };
export type StopReason = "deadline" | "daily_budget" | "not_started_by_launcher";
export type Stop = { taskArn: string; reason: StopReason };

/** Which tasks to stop now. Run from outside the tasks, on a schedule. */
export function reap(
  tasks: readonly RunningTask[],
  now: Date,
  spentTodayUsd: number,
  dailyUsd: number = LIMITS.dailyUsd,
): Stop[] {
  return tasks.flatMap((task): Stop[] => {
    const started = parseStartedBy(task.startedBy);
    if (started === undefined) {
      // A task here that the launcher did not start has no deadline to hold it to.
      return [{ taskArn: task.taskArn, reason: "not_started_by_launcher" }];
    }
    if (now.getTime() >= started.deadline.getTime()) {
      return [{ taskArn: task.taskArn, reason: "deadline" }];
    }
    if (spentTodayUsd >= dailyUsd) {
      return [{ taskArn: task.taskArn, reason: "daily_budget" }];
    }
    return [];
  });
}
// #endregion reap

/** 00:00 UTC of the day `now` is in. */
export const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
