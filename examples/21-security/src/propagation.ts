export type Wait = {
  attempts: number;
  delayMs: number;
  /** Injected, so tests do not wait. */
  sleep: (ms: number) => Promise<void>;
};

export class StillDenied extends Error {
  override name = "StillDenied";
}

// #region until-allowed
/**
 * Runs `attempt` until it stops being denied. Only denials are retried: any other
 * error is a different problem, and waiting would hide it.
 */
export async function untilAllowed<T>(
  attempt: () => Promise<T>,
  isDenied: (error: unknown) => boolean,
  wait: Wait,
): Promise<{ value: T; denials: number }> {
  let denials = 0;
  for (;;) {
    try {
      return { value: await attempt(), denials };
    } catch (error) {
      if (!isDenied(error)) {
        throw error;
      }
      denials += 1;
      if (denials >= wait.attempts) {
        // After this long it is not propagation any more. Go read the policy.
        throw new StillDenied(`still denied after ${denials} attempts over ${(denials - 1) * wait.delayMs} ms`, {
          cause: error,
        });
      }
      await wait.sleep(wait.delayMs);
    }
  }
}
// #endregion until-allowed

// #region until-denied
/**
 * After a permission is removed, one denial proves little: the next request can
 * reach a server that has not heard yet. Asks for `consecutive` denials in a row.
 */
export async function untilDenied(
  probe: () => Promise<"allowed" | "denied">,
  consecutive: number,
  wait: Wait,
): Promise<{ confirmed: boolean; probes: number; lastAllowedAt: number | null }> {
  let streak = 0;
  let lastAllowedAt: number | null = null;
  for (let probes = 1; probes <= wait.attempts; probes++) {
    if ((await probe()) === "denied") {
      streak += 1;
      if (streak >= consecutive) {
        return { confirmed: true, probes, lastAllowedAt };
      }
    } else {
      streak = 0;
      lastAllowedAt = probes;
    }
    await wait.sleep(wait.delayMs);
  }
  return { confirmed: false, probes: wait.attempts, lastAllowedAt };
}
// #endregion until-denied
