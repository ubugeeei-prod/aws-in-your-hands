// One task execution against two in-memory buckets: list, copy, delete, verify.
// The steps are separate so that a test can change the source between them.

import { checksumOf, type MemoryBucket } from "./memory-bucket.ts";
import { type Plan, planExecution, scopeOf } from "./plan.ts";
import type { ArchiveTask } from "./task.ts";

export type Step = { kind: "listed" } | { kind: "copied" | "deleted"; key: string };

export type ExecutionResult = {
  /** INTERRUPTED is this model's name for an execution that stopped part-way. */
  status: "SUCCESS" | "ERROR" | "INTERRUPTED";
  plan: Plan;
  transferred: string[];
  deleted: string[];
  /** In the plan, but gone from the source by the time its turn came. */
  vanished: string[];
  verifyErrors: { key: string; error: "checksum" | "added" | "removed" }[];
};

export type ExecutionHooks = {
  /** Runs after each step. A test writes to either bucket here. */
  afterStep?: (step: Step) => void;
  /** Stop after this many copies, as a cancelled or failed execution would. */
  stopAfterCopies?: number;
};

// #region run
export function runExecution(
  source: MemoryBucket,
  destination: MemoryBucket,
  task: ArchiveTask,
  hooks: ExecutionHooks = {},
): ExecutionResult {
  // PREPARING: both sides are listed once. Everything after works from this listing.
  const plan = planExecution(source.list(), destination.list(), task);
  hooks.afterStep?.({ kind: "listed" });

  const result: ExecutionResult = {
    status: "SUCCESS",
    plan,
    transferred: [],
    deleted: [],
    vanished: [],
    verifyErrors: [],
  };
  const copiedChecksums = new Map<string, string>();

  // TRANSFERRING: each object is read when its turn comes, not when it was listed.
  for (const transfer of plan.transfer) {
    if (result.transferred.length === hooks.stopAfterCopies) {
      return { ...result, status: "INTERRUPTED" };
    }
    const body = source.get(transfer.key);
    if (body === undefined) {
      result.vanished.push(transfer.key);
      continue;
    }
    destination.put(transfer.key, body);
    copiedChecksums.set(transfer.key, checksumOf(body));
    result.transferred.push(transfer.key);
    hooks.afterStep?.({ kind: "copied", key: transfer.key });
  }

  for (const key of plan.delete) {
    destination.delete(key);
    result.deleted.push(key);
    hooks.afterStep?.({ kind: "deleted", key });
  }

  result.verifyErrors = verify(source, destination, task, copiedChecksums);
  return { ...result, status: result.verifyErrors.length === 0 ? "SUCCESS" : "ERROR" };
}
// #endregion run

// #region verify
function verify(
  source: MemoryBucket,
  destination: MemoryBucket,
  task: ArchiveTask,
  copied: ReadonlyMap<string, string>,
): ExecutionResult["verifyErrors"] {
  const errors: ExecutionResult["verifyErrors"] = [];
  const mode = task.options.verifyMode;
  if (mode === "NONE") {
    return errors;
  }
  const after = new Map(destination.list().map((entry) => [entry.key, entry.checksum]));
  if (mode === "ONLY_FILES_TRANSFERRED") {
    // What was read from the source against what the destination now holds.
    for (const [key, checksum] of copied) {
      if (after.get(key) !== checksum) {
        errors.push({ key, error: "checksum" });
      }
    }
    return errors;
  }
  // POINT_IN_TIME_CONSISTENT: the whole source against the whole destination, as they are now.
  const current = new Map(
    source
      .list()
      .filter((entry) => scopeOf(task, entry.key) === "in")
      .map((entry) => [entry.key, entry.checksum]),
  );
  for (const [key, checksum] of current) {
    const copy = after.get(key);
    if (copy === undefined) {
      errors.push({ key, error: "added" });
    } else if (copy !== checksum && task.options.overwriteMode === "ALWAYS") {
      errors.push({ key, error: "checksum" });
    }
  }
  if (task.options.preserveDeletedFiles === "REMOVE") {
    for (const key of after.keys()) {
      if (!current.has(key) && scopeOf(task, key) === "in") {
        errors.push({ key, error: "removed" });
      }
    }
  }
  return errors;
}
// #endregion verify
