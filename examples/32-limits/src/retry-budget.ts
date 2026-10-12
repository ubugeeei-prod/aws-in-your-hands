// #region budget
export type RetryBudgetPolicy = {
  capacity: number;
  /** Taken out for every retry. */
  retryCost: number;
  /** Put back by a call that succeeded on its first attempt. */
  successRefund: number;
};

export type RetryBudget = {
  /** True when a retry may be sent; the cost is taken. False: answer with the failure instead. */
  spend(): boolean;
  /** A call succeeded. `afterRetry` gives the retry's cost back; otherwise the small refund. */
  succeeded(afterRetry: boolean): void;
  available(): number;
};

/** Shared by every call one client object makes. It limits retries, never first attempts. */
export function createRetryBudget(policy: RetryBudgetPolicy): RetryBudget {
  let tokens = policy.capacity;
  return {
    spend() {
      if (tokens < policy.retryCost) {
        return false;
      }
      tokens -= policy.retryCost;
      return true;
    },
    succeeded(afterRetry) {
      const refund = afterRetry ? policy.retryCost : policy.successRefund;
      tokens = Math.min(policy.capacity, tokens + refund);
    },
    available: () => tokens,
  };
}
// #endregion budget
