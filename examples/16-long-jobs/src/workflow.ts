// The part of Amazon States Language this chapter uses, typed. Not the whole language.
export type Retrier = {
  ErrorEquals: string[];
  IntervalSeconds?: number;
  MaxAttempts?: number;
  BackoffRate?: number;
  JitterStrategy?: "FULL" | "NONE";
};
export type Catcher = { ErrorEquals: string[]; ResultPath: `$.${string}`; Next: string };
export type TaskState = {
  Type: "Task";
  Resource: string;
  TimeoutSeconds: number;
  Retry?: Retrier[];
  Catch?: Catcher[];
  Next: string;
};
export type ChoiceState = {
  Type: "Choice";
  Choices: { Variable: `$.${string}`; BooleanEquals: boolean; Next: string }[];
  Default: string;
};
export type SucceedState = { Type: "Succeed" };
export type FailState = { Type: "Fail"; Error: string; Cause: string };
export type State = TaskState | ChoiceState | SucceedState | FailState;
export type StateMachine = {
  Comment: string;
  StartAt: string;
  TimeoutSeconds: number;
  States: Record<string, State>;
};

export const EXPORT_PAGES_TIMEOUT_SECONDS = 300;

// #region definition
// Whatever goes wrong inside a step, the same step runs again with the same input.
// States.ALL leaves out States.Runtime and States.DataLimitExceeded.
const retryAnything: Retrier = {
  ErrorEquals: ["States.ALL"],
  IntervalSeconds: 5,
  MaxAttempts: 3,
  BackoffRate: 2,
  JitterStrategy: "FULL",
};

/** `functions` are Lambda function ARNs on AWS, and plain names in the local run. */
export function exportWorkflow(functions: {
  exportPages: string;
  finish: string;
  discard: string;
}): StateMachine {
  return {
    Comment: "Exports every note to S3 in part files, resumable after any step",
    StartAt: "ExportPages",
    // An export that is still open after six hours is stuck, not slow.
    TimeoutSeconds: 6 * 60 * 60,
    States: {
      ExportPages: {
        Type: "Task",
        Resource: functions.exportPages,
        // A little longer than the function's own timeout, so Lambda reports first.
        TimeoutSeconds: EXPORT_PAGES_TIMEOUT_SECONDS + 30,
        Retry: [retryAnything],
        Next: "MorePages",
      },
      MorePages: {
        Type: "Choice",
        Choices: [{ Variable: "$.done", BooleanEquals: true, Next: "Finish" }],
        Default: "ExportPages",
      },
      Finish: {
        Type: "Task",
        Resource: functions.finish,
        TimeoutSeconds: 90,
        // A missing part does not come back on a retry.
        Retry: [{ ErrorEquals: ["ExportCorrupt"], MaxAttempts: 0 }, retryAnything],
        Catch: [{ ErrorEquals: ["ExportCorrupt"], ResultPath: "$.error", Next: "Discard" }],
        Next: "Exported",
      },
      Exported: { Type: "Succeed" },
      Discard: {
        Type: "Task",
        Resource: functions.discard,
        TimeoutSeconds: 330,
        Retry: [retryAnything],
        Next: "Discarded",
      },
      Discarded: {
        Type: "Fail",
        Error: "ExportDiscarded",
        Cause:
          "Parts were missing when the export was about to finish. What was left has been deleted.",
      },
    },
  };
}
// #endregion definition
