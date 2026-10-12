import type { WorkflowJobDelivery, WorkflowRun } from "./events.ts";

// #region policy
export type Policy = {
  /** `owner/repo`, exactly. No pattern: a wildcard here is a runner for somebody else's code. */
  repositories: readonly string[];
  /** The one label the runners carry. */
  label: string;
  /** What may start a run that gets a runner. `pull_request_target` is left out on purpose. */
  events: readonly string[];
};

export const TRUSTED_EVENTS = ["push", "pull_request", "workflow_dispatch", "schedule"] as const;
// #endregion policy

export type Job = {
  repository: string;
  installationId: number;
  jobId: number;
  runId: number;
};

export type Refusal =
  | "other_event"
  | "not_queued"
  | "labels_not_ours"
  | "repository_not_allowed"
  | "public_repository"
  | "not_from_app"
  | "event_not_trusted"
  | "fork";

export type Screening = { kind: "launch"; job: Job } | { kind: "skip"; reason: Refusal };

// #region screen
/** From the delivery alone: is this a job that one of our runners should exist for? */
export function screen(delivery: WorkflowJobDelivery, policy: Policy): Screening {
  const skip = (reason: Refusal): Screening => ({ kind: "skip", reason });
  if (delivery.action !== "queued") {
    return skip("not_queued");
  }
  const { labels } = delivery.workflow_job;
  // Jobs for GitHub's own runners arrive here too. A job that asks for a label the
  // runner will not carry would leave the runner waiting for a job it never gets.
  if (labels.length === 0 || labels.some((label) => label !== policy.label)) {
    return skip("labels_not_ours");
  }
  if (!policy.repositories.includes(delivery.repository.full_name)) {
    return skip("repository_not_allowed");
  }
  if (!delivery.repository.private) {
    return skip("public_repository");
  }
  if (delivery.installation === undefined) {
    return skip("not_from_app");
  }
  return {
    kind: "launch",
    job: {
      repository: delivery.repository.full_name,
      installationId: delivery.installation.id,
      jobId: delivery.workflow_job.id,
      runId: delivery.workflow_job.run_id,
    },
  };
}
// #endregion screen

// #region admit
/** From the run the job belongs to: did its code come from the repository itself? */
export function admit(run: WorkflowRun, job: Job, policy: Policy): Refusal | null {
  if (!policy.events.includes(run.event)) {
    return "event_not_trusted";
  }
  // A pull request from a fork runs in the base repository, with the fork as the head.
  if (run.repository.full_name !== job.repository || run.head_repository === null) {
    return "fork";
  }
  return run.head_repository.full_name === job.repository ? null : "fork";
}
// #endregion admit

// #region name
/** A new name for every attempt, so a runner left behind by a failed launch never blocks the next. */
export function runnerName(jobId: number, nonce: string): string {
  return `aih-${jobId}-${nonce}`;
}
// #endregion name
