import type { StackStatus } from "@aws-sdk/client-cloudformation";

// A deploy is many API calls, and it can stop between any two of them.
// The stack status says where it stopped, and that decides what is safe next.

// #region next-step
export type NextStep = {
  state: "settled" | "rolled-back" | "in-progress" | "needs-repair" | "gone";
  /** May `cdk deploy` be run now? */
  deployable: boolean;
  advice: string;
};

export function nextStep(status: StackStatus): NextStep {
  switch (status) {
    case "CREATE_COMPLETE":
    case "UPDATE_COMPLETE":
    case "IMPORT_COMPLETE":
      return {
        state: "settled",
        deployable: true,
        advice: "The last operation finished. Nothing to repair.",
      };

    case "UPDATE_ROLLBACK_COMPLETE":
    case "IMPORT_ROLLBACK_COMPLETE":
      return {
        state: "rolled-back",
        deployable: true,
        advice:
          "The last update failed and CloudFormation put the template's resources back. " +
          "Data written meanwhile was not put back. Read the stack events for the first failure, fix it, deploy again.",
      };

    case "CREATE_IN_PROGRESS":
    case "UPDATE_IN_PROGRESS":
    case "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS":
    case "ROLLBACK_IN_PROGRESS":
    case "UPDATE_ROLLBACK_IN_PROGRESS":
    case "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS":
    case "DELETE_IN_PROGRESS":
    case "IMPORT_IN_PROGRESS":
    case "IMPORT_ROLLBACK_IN_PROGRESS":
      return {
        state: "in-progress",
        deployable: false,
        advice:
          "An operation is running. Old and new resources may both be serving. Wait; do not start another.",
      };

    case "REVIEW_IN_PROGRESS":
      return {
        state: "needs-repair",
        deployable: false,
        advice:
          "A change set created this stack but was never executed. Execute it or delete the stack.",
      };

    case "ROLLBACK_COMPLETE":
      return {
        state: "rolled-back",
        deployable: true,
        advice:
          "The first create failed and was undone. CloudFormation can only delete this stack; " +
          "aws-cdk 2.1145.0 deletes it on the next deploy and creates it again. Find out why the create failed first.",
      };

    case "UPDATE_ROLLBACK_FAILED":
      return {
        state: "needs-repair",
        deployable: false,
        advice:
          "The update failed, and so did undoing it: some resources are new, some old. " +
          "Fix what blocks the rollback, then continue it (`cdk rollback`). It cannot be updated until then.",
      };

    case "CREATE_FAILED":
    case "UPDATE_FAILED":
      return {
        state: "needs-repair",
        deployable: true,
        advice:
          "Rollback was disabled, so the stack stopped half-way. Either fix and deploy again to go forward, " +
          "or roll back (`cdk rollback`). Decide which before touching anything else.",
      };

    case "ROLLBACK_FAILED":
    case "DELETE_FAILED":
      return {
        state: "needs-repair",
        deployable: false,
        advice:
          "Some resources could not be removed. Read the stack events, clear what blocks them, delete again.",
      };

    case "IMPORT_ROLLBACK_FAILED":
      return {
        state: "needs-repair",
        deployable: false,
        advice:
          "An import could not be undone. Read the stack events. This book does not cover repairing imports.",
      };

    case "DELETE_COMPLETE":
      return {
        state: "gone",
        deployable: true,
        advice: "The stack was deleted. A deploy creates it from scratch.",
      };
  }
}
// #endregion next-step
