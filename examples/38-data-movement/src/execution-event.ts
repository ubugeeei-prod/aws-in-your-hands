// The EventBridge event DataSync sends when a task execution changes state,
// and what this app does with it. The only fields AWS's own sample shows are
// the envelope, the execution's ARN in `resources`, and `detail.State`.

import * as v from "valibot";

// #region schema
// arn:aws:datasync:<region>:<account>:task/task-<id>/execution/exec-<id>
const EXECUTION_ARN =
  /^arn:aws[a-z-]*:datasync:([a-z0-9-]+):(\d{12}):task\/(task-[0-9a-z]+)\/execution\/(exec-[0-9a-z]+)$/;

export const executionEventSchema = v.object({
  source: v.literal("aws.datasync"),
  "detail-type": v.literal("DataSync Task Execution State Change"),
  account: v.pipe(v.string(), v.regex(/^\d{12}$/)),
  region: v.pipe(v.string(), v.minLength(1)),
  time: v.pipe(v.string(), v.isoTimestamp()),
  resources: v.pipe(v.array(v.pipe(v.string(), v.regex(EXECUTION_ARN))), v.length(1)),
  // Only SUCCESS and ERROR are confirmed spellings. Others pass as strings and are ignored below.
  detail: v.object({ State: v.pipe(v.string(), v.minLength(1)) }),
});
export type ExecutionEvent = v.InferOutput<typeof executionEventSchema>;
// #endregion schema

export type Execution = {
  executionArn: string;
  taskArn: string;
  taskId: string;
  executionId: string;
  state: string;
  at: string;
};

export function executionOf(event: ExecutionEvent): Execution {
  const [executionArn = ""] = event.resources;
  const [, , , taskId = "", executionId = ""] = EXECUTION_ARN.exec(executionArn) ?? [];
  return {
    executionArn,
    taskArn: executionArn.slice(0, executionArn.indexOf("/execution/")),
    taskId,
    executionId,
    state: event.detail.State,
    at: event.time,
  };
}

// #region decide
export type Decision =
  | { action: "alert"; reason: "execution_failed" | "unreadable_event"; message: string }
  | { action: "record"; reason: "execution_succeeded" }
  | { action: "ignore"; reason: "other_task" | "not_final" };

/**
 * A failed copy reaches a person. So does an event this code cannot read: a
 * shape that changed must not look like a quiet night. Everything else is noise.
 */
export function decide(input: unknown, watchedTaskArn: string): Decision {
  const parsed = v.safeParse(executionEventSchema, input);
  if (!parsed.success) {
    const paths = parsed.issues.map((issue) => v.getDotPath(issue) ?? "(root)");
    return {
      action: "alert",
      reason: "unreadable_event",
      message: `An event matched the DataSync rule but not the expected shape: ${[...new Set(paths)].join(", ")}`,
    };
  }
  const execution = executionOf(parsed.output);
  if (execution.taskArn !== watchedTaskArn) {
    return { action: "ignore", reason: "other_task" };
  }
  if (execution.state === "ERROR") {
    return {
      action: "alert",
      reason: "execution_failed",
      message: `The archive copy ${execution.executionId} of ${execution.taskId} ended in ERROR at ${execution.at}. The archive is older than its schedule promises until a later execution succeeds.`,
    };
  }
  return execution.state === "SUCCESS"
    ? { action: "record", reason: "execution_succeeded" }
    : { action: "ignore", reason: "not_final" };
}
// #endregion decide
