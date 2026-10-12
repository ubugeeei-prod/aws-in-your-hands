import * as v from "valibot";

import { readToken, tokenRequest } from "./github.ts";
import { decide, jobRequestSchema, overridesFor, parseStartedBy, type Refusal } from "./job.ts";
import { estimateUsd, startOfUtcDay } from "./limits.ts";
import type { Ports, Settings } from "./ports.ts";

export type LaunchResult =
  | { launched: string; jobId: string; workBranch: string; deadline: string }
  | { alreadyLaunched: string[]; jobId: string }
  | { refused: Refusal | "invalid_request" | "request_too_large"; detail: string }
  | { failed: "token" | "run_task"; detail: string };

// #region launch
/** One request in, at most one task out. Every reason to say no is checked before anything is created. */
export async function launch(
  input: unknown,
  ports: Ports,
  settings: Settings,
): Promise<LaunchResult> {
  const parsed = v.safeParse(jobRequestSchema, input);
  if (!parsed.success) {
    const fields = parsed.issues.map((issue) => v.getDotPath(issue) ?? "(root)");
    return { refused: "invalid_request", detail: fields.join(", ") };
  }
  const request = parsed.output;
  const now = ports.now();

  const running = await ports.runningTasks();
  // The same request delivered twice: answer with the task that is already there.
  const same = running.filter(
    (task) => parseStartedBy(task.startedBy)?.jobId === request.requestId,
  );
  if (same.length > 0) {
    return { alreadyLaunched: same.map((task) => task.taskArn), jobId: request.requestId };
  }
  const spentTodayUsd = estimateUsd(
    await ports.tokensSince(startOfUtcDay(now), now),
    settings.model,
  );
  const decision = decide(request, {
    allowedRepositories: settings.allowedRepositories,
    running: running.length,
    spentTodayUsd,
    now,
  });
  if ("refuse" in decision) {
    return { refused: decision.refuse, detail: decision.detail };
  }
  const plan = decision.launch;

  // Only now is a credential made. It is for one repository, and it dies within the hour.
  const ask = tokenRequest(await ports.githubApp(), request.repository, now);
  if (ask === undefined) {
    return {
      refused: "repository_not_allowed",
      detail: "the GitHub App is installed on another owner",
    };
  }
  const answer = await ports.http(ask);
  if (answer.status !== 201) {
    return { failed: "token", detail: `GitHub answered ${answer.status}` };
  }
  let token: string;
  try {
    token = readToken(answer.body, request.repository, plan.deadline).token;
  } catch (error) {
    return { failed: "token", detail: error instanceof Error ? error.message : String(error) };
  }

  const overrides = overridesFor(plan, token);
  if (overrides === undefined) {
    return { refused: "request_too_large", detail: "the overrides exceed RunTask's limit" };
  }
  const started = await ports.runTask(plan, overrides);
  if ("conflict" in started) {
    return { alreadyLaunched: started.conflict, jobId: plan.jobId };
  }
  if ("failure" in started) {
    return { failed: "run_task", detail: started.failure };
  }
  return {
    launched: started.taskArn,
    jobId: plan.jobId,
    workBranch: plan.workBranch,
    deadline: plan.deadline.toISOString(),
  };
}
// #endregion launch
