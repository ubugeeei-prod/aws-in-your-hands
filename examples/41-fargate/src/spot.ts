import type { Timing } from "@aih/example-12-containers/src/timing.ts";

/** Seconds between the interruption notice (SIGTERM) and the end of a Fargate Spot task. */
export const SPOT_NOTICE = 120;

// #region spot
/** Why a set of durations would lose work when a Spot task is taken back. Empty when it would not. */
export function spotProblems(t: Timing): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, message: string): void => void (ok || problems.push(message));

  check(
    t.stopTimeout <= SPOT_NOTICE,
    "the stop timeout is longer than the two-minute notice, so the task ends before the timeout does",
  );
  check(
    t.shutdownDeadline < t.stopTimeout,
    "SIGKILL arrives before the server's own deadline, so it cannot report what it dropped",
  );
  check(
    t.shutdownDeadline >= t.longestRequest,
    "the server gives up on a request that was still within its expected time",
  );
  return problems;
}
// #endregion spot
