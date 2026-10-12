// How old the archive may be, as a number that follows from the schedule.

// #region lag
export type LagInput = {
  /** Hours between scheduled starts. DataSync's minimum is 1. */
  intervalHours: number;
  /** How long one execution is allowed to take before it counts as late. */
  executionHours: number;
  /** Consecutive failed or missing executions before someone must have acted. */
  toleratedFailures: number;
};

/**
 * The oldest an object's copy can be while everything is inside its limits: a
 * write just after one listing waits a whole interval for the next one, then
 * for that execution to reach it. Each tolerated failure adds one more interval.
 */
export function worstCaseLagHours(input: LagInput): number {
  if (input.intervalHours < 1) {
    throw new Error("DataSync does not schedule a task more often than once an hour");
  }
  return input.intervalHours * (1 + input.toleratedFailures) + input.executionHours;
}

/** Whether the archive has fallen behind what the schedule promises. */
export function isStale(lastSuccess: Date | undefined, now: Date, input: LagInput): boolean {
  if (lastSuccess === undefined) {
    return true;
  }
  return now.getTime() - lastSuccess.getTime() > worstCaseLagHours(input) * 3_600_000;
}
// #endregion lag
