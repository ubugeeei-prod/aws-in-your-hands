import * as v from "valibot";

import { CONTAINER, LIMITS, REPOSITORY_PATTERN } from "./config.ts";

const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,100}(?<![./])$/;

// #region request
/** What a person asks the launcher for. Unknown keys are refused, not dropped. */
export const jobRequestSchema = v.strictObject({
  // Names the request. The same ID twice starts one task.
  requestId: v.pipe(
    v.string(),
    v.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  ),
  repository: v.pipe(v.string(), v.regex(REPOSITORY_PATTERN, "write owner/name")),
  baseBranch: v.optional(v.pipe(v.string(), v.regex(BRANCH)), "main"),
  // Travels in RunTask's overrides, which hold 8192 characters in all.
  task: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2000)),
  minutes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), LIMITS.defaultMinutes),
  budgetUsd: v.optional(v.pipe(v.number(), v.finite(), v.gtValue(0)), LIMITS.defaultJobUsd),
});
export type JobRequest = v.InferOutput<typeof jobRequestSchema>;
// #endregion request

export type Refusal =
  | "repository_not_allowed"
  | "minutes_over_limit"
  | "budget_over_limit"
  | "too_many_running"
  | "daily_budget_spent";

export type LaunchPlan = {
  jobId: string;
  /** The only branch the task pushes. */
  workBranch: string;
  deadline: Date;
  /** RunTask's startedBy. The reaper reads the deadline back out of it. */
  startedBy: string;
  /** RunTask's clientToken. */
  clientToken: string;
  /** Environment for the container, without the Git token, which the launcher adds last. */
  environment: { name: string; value: string }[];
};

export type Decision = { launch: LaunchPlan } | { refuse: Refusal; detail: string };

export type Situation = {
  /** `owner/name`, from the stack's context. */
  allowedRepositories: readonly string[];
  /** Tasks of this cluster that are not stopped. */
  running: number;
  /** What the model has cost today by the outside count. */
  spentTodayUsd: number;
  now: Date;
};

// #region decide
/** Whether to start a task for this request, and with what. No AWS call, no clock, no randomness. */
export function decide(request: JobRequest, situation: Situation): Decision {
  const repository = request.repository.toLowerCase();
  // GitHub treats owner and repository names without regard to case, so the comparison does too.
  if (!situation.allowedRepositories.some((allowed) => allowed.toLowerCase() === repository)) {
    return { refuse: "repository_not_allowed", detail: request.repository };
  }
  if (request.minutes > LIMITS.maxMinutes) {
    return { refuse: "minutes_over_limit", detail: `${request.minutes} > ${LIMITS.maxMinutes}` };
  }
  if (request.budgetUsd > LIMITS.maxJobUsd) {
    return { refuse: "budget_over_limit", detail: `${request.budgetUsd} > ${LIMITS.maxJobUsd}` };
  }
  if (situation.running >= LIMITS.maxConcurrent) {
    return { refuse: "too_many_running", detail: `${situation.running} running` };
  }
  if (situation.spentTodayUsd >= LIMITS.dailyUsd) {
    return { refuse: "daily_budget_spent", detail: `USD ${situation.spentTodayUsd.toFixed(2)}` };
  }

  const deadline = new Date(situation.now.getTime() + request.minutes * 60_000);
  const deadlineSeconds = Math.floor(deadline.getTime() / 1000);
  // A name of its own: whatever the base branch is called, the task cannot push to it by this name.
  const workBranch = `agent/${request.requestId}`;
  return {
    launch: {
      jobId: request.requestId,
      workBranch,
      deadline,
      startedBy: startedBy(request.requestId, deadlineSeconds),
      clientToken: request.requestId,
      environment: [
        { name: "JOB_ID", value: request.requestId },
        { name: "REPOSITORY", value: request.repository },
        { name: "BASE_BRANCH", value: request.baseBranch },
        { name: "WORK_BRANCH", value: workBranch },
        { name: "TASK", value: request.task },
        { name: "MAX_BUDGET_USD", value: String(request.budgetUsd) },
        { name: "MAX_TURNS", value: String(LIMITS.maxTurns) },
        { name: "DEADLINE_SECONDS", value: String(deadlineSeconds) },
      ],
    },
  };
}
// #endregion decide

// #region started-by
/** startedBy allows letters, digits, hyphens, slashes and underscores, 128 characters at the most. */
export const startedBy = (jobId: string, deadlineSeconds: number): string =>
  `aih/${deadlineSeconds}/${jobId}`;

const STARTED_BY = /^aih\/(\d{10})\/([0-9a-f-]{36})$/;

export function parseStartedBy(
  value: string | undefined,
): { jobId: string; deadline: Date } | undefined {
  const match = STARTED_BY.exec(value ?? "");
  return match === null
    ? undefined
    : { jobId: match[2] ?? "", deadline: new Date(Number(match[1]) * 1000) };
}
// #endregion started-by

// #region overrides
export type RunTaskOverrides = {
  containerOverrides: { name: string; environment: { name: string; value: string }[] }[];
};

/** The overrides for RunTask, or undefined when they would not fit. */
export function overridesFor(plan: LaunchPlan, gitToken: string): RunTaskOverrides | undefined {
  const overrides = {
    containerOverrides: [
      {
        name: CONTAINER,
        environment: [...plan.environment, { name: "GIT_TOKEN", value: gitToken }],
      },
    ],
  };
  // The limit counts the JSON's own punctuation too.
  return JSON.stringify(overrides).length <= LIMITS.maxOverrideCharacters ? overrides : undefined;
}
// #endregion overrides
