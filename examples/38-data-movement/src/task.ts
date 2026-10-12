// The one description of the archive copy. The CDK stack turns it into the
// DataSync task, and the planner reads the same object to say what a run would do.

import { includePatternProblem, splitFilter } from "./filters.ts";

// #region options
export type TaskOptions = {
  /** CHANGED compares the two sides first. ALL copies everything without looking at the destination. */
  transferMode: "CHANGED" | "ALL";
  /** NEVER leaves an object that already exists in the destination alone, whatever the source says. */
  overwriteMode: "ALWAYS" | "NEVER";
  /** PRESERVE keeps what the source no longer has. REMOVE deletes it from the destination. */
  preserveDeletedFiles: "PRESERVE" | "REMOVE";
  /** When the end-of-transfer check runs over what was copied, over everything, or not at all. */
  verifyMode: "ONLY_FILES_TRANSFERRED" | "POINT_IN_TIME_CONSISTENT" | "NONE";
  objectTags: "PRESERVE" | "NONE";
  logLevel: "OFF" | "BASIC" | "TRANSFER";
};

export type ArchiveTask = {
  mode: "BASIC" | "ENHANCED";
  options: TaskOptions;
  /** DataSync filter strings: patterns joined with "|". */
  includes: string | undefined;
  excludes: string | undefined;
  /** A cron or rate expression. DataSync refuses anything more frequent than hourly. */
  schedule: string;
};
// #endregion options

// #region archive-task
export const ARCHIVE_TASK: ArchiveTask = {
  // Basic mode has no fee per execution, and its 25 million object quota is far away for attachments.
  mode: "BASIC",
  options: {
    transferMode: "CHANGED",
    overwriteMode: "ALWAYS",
    // An archive that forgets with the source is a mirror. `-c deletes=remove` makes it one.
    preserveDeletedFiles: "PRESERVE",
    // The source is live. Checking both sides in full fails whenever an upload lands mid-run.
    verifyMode: "ONLY_FILES_TRANSFERRED",
    objectTags: "PRESERVE",
    logLevel: "BASIC",
  },
  includes: undefined,
  excludes: undefined,
  // 18:00 UTC is 03:00 in Tokyo.
  schedule: "cron(0 18 * * ? *)",
};
// #endregion archive-task

// The quota page's limit on one task's filters, include and exclude together.
export const MAX_FILTER_CHARACTERS = 102_400;

// #region check
/** Combinations DataSync's documentation rules out. An empty list means the task can be created. */
export function taskProblems(task: ArchiveTask): string[] {
  const problems: string[] = [];
  const { options } = task;
  if (options.transferMode === "ALL" && options.preserveDeletedFiles === "REMOVE") {
    problems.push(
      "TransferMode ALL never scans the destination, so it cannot be combined with PreserveDeletedFiles REMOVE",
    );
  }
  if (task.mode === "ENHANCED" && options.verifyMode === "POINT_IN_TIME_CONSISTENT") {
    problems.push("Enhanced mode verifies only transferred data");
  }
  for (const pattern of splitFilter(task.includes)) {
    const problem = includePatternProblem(pattern);
    if (problem !== undefined) {
      problems.push(problem);
    }
  }
  if ((task.includes ?? "").length + (task.excludes ?? "").length > MAX_FILTER_CHARACTERS) {
    problems.push(`filters are longer than ${MAX_FILTER_CHARACTERS} characters`);
  }
  return problems;
}
// #endregion check
