// A model of what happens to the requests a task is holding when it is told to
// go. It is this chapter's reading of the documented order, not ECS itself.

// #region in-flight
/**
 * The requests a task is in the middle of at one instant, as seconds each still needs.
 * Arrivals are evenly spaced; durations repeat in the given order. Nothing is random.
 */
export function inFlightAt(
  requestsPerMinute: number,
  durationsSeconds: readonly number[],
): number[] {
  if (requestsPerMinute <= 0 || durationsSeconds.length === 0) {
    return [];
  }
  const gap = 60 / requestsPerMinute;
  const longest = Math.max(...durationsSeconds);
  const remaining: number[] = [];
  // Request k arrived k gaps before the instant, k = 1, 2, ... back to the longest duration.
  for (let k = 1; k * gap < longest; k += 1) {
    const duration = durationsSeconds[k % durationsSeconds.length] ?? 0;
    const left = duration - k * gap;
    if (left > 0) {
      remaining.push(Number(left.toFixed(3)));
    }
  }
  return remaining;
}
// #endregion in-flight

// #region outcome
export type StopSettings = {
  /** How long the load balancer lets requests finish on a target it has stopped routing to. */
  deregistrationDelay: number;
  /** After SIGTERM, how long the server waits for requests. 0: the process exits on the signal. */
  shutdownDeadline: number;
  /** After SIGTERM, how long ECS waits before SIGKILL. */
  stopTimeout: number;
};

export type StopOrder =
  /** Scale-in and deployments: the target is deregistered, and SIGTERM comes after the delay. */
  | "deregister-first"
  /** The worst case this chapter assumes for a Spot interruption: SIGTERM at the same moment. */
  | "signal-at-once";

export type Outcome = { answered: number; cut: number };

/** How many of the requests in flight get their answer. */
export function stopOutcome(
  remainingSeconds: readonly number[],
  settings: StopSettings,
  order: StopOrder,
): Outcome {
  const processGrace = Math.min(settings.shutdownDeadline, settings.stopTimeout);
  const grace =
    order === "deregister-first"
      ? // The process is still running for the whole delay; only the load balancer's patience counts.
        settings.deregistrationDelay
      : Math.min(settings.deregistrationDelay, processGrace);
  const answered = remainingSeconds.filter((left) => left <= grace).length;
  return { answered, cut: remainingSeconds.length - answered };
}
// #endregion outcome
