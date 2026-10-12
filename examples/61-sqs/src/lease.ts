// The visibility timeout read as a lease: the queue lends a message to one
// consumer for a while, and takes it back whether or not the consumer agrees.

export const MAX_VISIBILITY_SECONDS = 12 * 60 * 60;

// #region lambda
/** What Lambda's documentation asks of a queue it reads from. An empty list means it fits. */
export function checkLambdaTimeouts(settings: {
  visibilityTimeoutSeconds: number;
  functionTimeoutSeconds: number;
  batchWindowSeconds?: number;
}): string[] {
  const { visibilityTimeoutSeconds, functionTimeoutSeconds, batchWindowSeconds = 0 } = settings;
  const problems: string[] = [];
  if (functionTimeoutSeconds > visibilityTimeoutSeconds) {
    problems.push(
      `the function may run ${functionTimeoutSeconds} s and the queue lends a message for ` +
        `${visibilityTimeoutSeconds} s: Lambda refuses to create the event source mapping`,
    );
  }
  const recommended = 6 * functionTimeoutSeconds + batchWindowSeconds;
  if (visibilityTimeoutSeconds < recommended) {
    problems.push(
      `the visibility timeout is ${visibilityTimeoutSeconds} s, under the recommended ` +
        `${recommended} s (six function timeouts plus the batch window)`,
    );
  }
  return problems;
}
// #endregion lambda

// #region heartbeat
/**
 * For a consumer that polls the queue itself and cannot say how long a
 * message will take: how many seconds to ask for in the next
 * ChangeMessageVisibility. The twelve hours count from the receive, and
 * asking for more than what is left is an error, not a shorter extension.
 */
export function nextExtension(lease: {
  receivedAtMs: number;
  nowMs: number;
  extendBySeconds: number;
}): { seconds: number } | "give_up" {
  const left = MAX_VISIBILITY_SECONDS - Math.ceil((lease.nowMs - lease.receivedAtMs) / 1000);
  const seconds = Math.min(lease.extendBySeconds, left);
  return seconds >= 1 ? { seconds } : "give_up";
}
// #endregion heartbeat
