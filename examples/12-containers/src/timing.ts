// #region timing
/**
 * Every duration that has to agree with another one, in seconds. The server
 * and the stack both read this object, so the two cannot drift apart.
 */
export const timing = {
  /** The longest a request is expected to take. Chapter 04 gave Lambda the same 10 seconds. */
  longestRequest: 10,

  /** How long the load balancer keeps an idle connection to a task. */
  albIdleTimeout: 60,
  /** How long the server keeps one. */
  serverKeepAlive: 65,

  healthCheckInterval: 10,
  healthCheckTimeout: 5,
  healthyThreshold: 2,
  unhealthyThreshold: 2,
  /** After a task starts, ECS ignores failed health checks for this long. */
  healthCheckGrace: 30,

  /** How long the load balancer lets requests finish on a task it has stopped routing to. */
  deregistrationDelay: 30,
  /** After SIGTERM, how long the server waits for requests before it gives up. */
  shutdownDeadline: 25,
  /** After SIGTERM, how long ECS waits before SIGKILL. */
  stopTimeout: 30,
} as const;

export type Timing = { [Key in keyof typeof timing]: number };
// #endregion timing

// #region rules
/** Why a set of durations would drop requests. Empty when it would not. */
export function timingProblems(t: Timing): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, message: string): void => void (ok || problems.push(message));

  check(
    t.serverKeepAlive > t.albIdleTimeout,
    "the server closes idle connections before the load balancer does, so the load balancer can send a request into a closed connection (502)",
  );
  check(
    t.shutdownDeadline < t.stopTimeout,
    "ECS sends SIGKILL before the server's own deadline, so the server never gets to report what it dropped",
  );
  check(
    t.shutdownDeadline >= t.longestRequest,
    "the server gives up on a request that was still within its expected time",
  );
  check(
    t.deregistrationDelay >= t.longestRequest,
    "the load balancer cuts a request that was still within its expected time",
  );
  check(
    t.stopTimeout >= 2 && t.stopTimeout <= 120,
    "Fargate accepts a stop timeout of 2 to 120 seconds",
  );
  check(
    t.healthCheckTimeout < t.healthCheckInterval,
    "a health check should give up before the next one starts",
  );
  check(
    t.healthCheckInterval >= 5 && t.healthCheckInterval <= 300,
    "the health check interval has to be 5 to 300 seconds",
  );
  check(
    [t.healthyThreshold, t.unhealthyThreshold].every((count) => count >= 2 && count <= 10),
    "health check thresholds have to be 2 to 10",
  );
  return problems;
}
// #endregion rules
