// Every hop has a timeout, and the caller's has to be the longest. These are this chapter's
// values and the check that keeps them in order.

// #region values
/** The longest API Gateway HTTP API waits for an integration. A quota that cannot be raised. */
export const HTTP_API_INTEGRATION_SECONDS = 30;

export const FUNCTION_TIMEOUT_SECONDS = 10;

/** Time kept back to write the error answer and the log line before Lambda stops the function. */
export const ANSWER_MARGIN_MS = 1000;

/** The SDK's HTTP timeouts are off unless set: a call that never answers waits forever. */
export const SDK = { connectionTimeoutMs: 1000, requestTimeoutMs: 2000, maxAttempts: 2 } as const;
// #endregion values

export type Finding = { rule: string; message: string };

// #region http
export type HttpChain = {
  callerSeconds: number;
  functionSeconds: number;
  answerMarginMs: number;
  sdk: { connectionTimeoutMs: number; requestTimeoutMs: number; maxAttempts: number };
};

export function checkHttpChain(chain: HttpChain): Finding[] {
  const findings: Finding[] = [];
  const functionMs = chain.functionSeconds * 1000;
  const deadlineMs = functionMs - chain.answerMarginMs;
  const attemptMs = chain.sdk.connectionTimeoutMs + chain.sdk.requestTimeoutMs;

  if (chain.functionSeconds >= chain.callerSeconds) {
    findings.push({
      rule: "function-outlives-caller",
      message: `The function may run ${chain.functionSeconds} s, but its caller stops waiting after ${chain.callerSeconds} s. Nobody receives what it does after that.`,
    });
  }
  if (chain.answerMarginMs <= 0 || deadlineMs <= 0) {
    findings.push({
      rule: "no-time-to-answer",
      message:
        "No time is kept back before the function timeout, so a slow call ends as a Lambda timeout instead of an error answer.",
    });
  }
  if (chain.sdk.connectionTimeoutMs === 0 || chain.sdk.requestTimeoutMs === 0) {
    findings.push({
      rule: "sdk-timeout-off",
      message: "An SDK timeout of 0 is no timeout. Only the function timeout would end the call.",
    });
  } else if (attemptMs > deadlineMs) {
    findings.push({
      rule: "attempt-outlives-deadline",
      message: `One SDK attempt may take ${attemptMs} ms, longer than the ${deadlineMs} ms the handler has.`,
    });
  }
  if (!Number.isInteger(chain.sdk.maxAttempts) || chain.sdk.maxAttempts < 1) {
    findings.push({
      rule: "attempts",
      message: "maxAttempts counts the first try and is at least 1.",
    });
  }
  return findings;
}
// #endregion http

// #region queue
/** For a function that reads an SQS queue, as chapter 08's worker does. */
export function checkQueueChain(chain: {
  functionSeconds: number;
  visibilitySeconds: number;
  batchWindowSeconds: number;
}): Finding[] {
  const findings: Finding[] = [];
  if (chain.functionSeconds > chain.visibilitySeconds) {
    findings.push({
      rule: "function-outlives-visibility",
      message:
        "The function timeout exceeds the visibility timeout. Lambda refuses such an event source mapping.",
    });
  }
  const recommended = 6 * chain.functionSeconds + chain.batchWindowSeconds;
  if (chain.visibilitySeconds < recommended) {
    findings.push({
      rule: "visibility-below-recommendation",
      message: `The visibility timeout is ${chain.visibilitySeconds} s. Lambda recommends at least ${recommended} s here: six times the function timeout plus the batch window.`,
    });
  }
  return findings;
}
// #endregion queue
