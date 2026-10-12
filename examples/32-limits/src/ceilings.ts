// #region inputs
/** The limits one request passes on its way through this chapter's stack. */
export type Limits = {
  /** API Gateway, all APIs of the account in the Region together. */
  accountRequestsPerSecond: number;
  /** The stage's own throttle. */
  stageRequestsPerSecond: number;
  /** Lambda, all functions of the account in the Region together. */
  accountConcurrency: number;
  /** This function's share, when one was reserved. */
  reservedConcurrency: number | undefined;
  tableReadUnitsPerSecond: number;
  tableWriteUnitsPerSecond: number;
};

/** What one request costs, on average. Measured, or assumed and said so. */
export type Workload = {
  durationSeconds: number;
  readUnits: number;
  writeUnits: number;
};

export type Ceiling = { limit: string; requestsPerSecond: number };
// #endregion inputs

// #region ceilings
/** Each limit as the request rate at which it starts to refuse, lowest first. */
export function ceilings(limits: Limits, workload: Workload): Ceiling[] {
  const concurrency = limits.reservedConcurrency ?? limits.accountConcurrency;
  const all: Ceiling[] = [
    { limit: "API Gateway account throttle", requestsPerSecond: limits.accountRequestsPerSecond },
    { limit: "stage throttle", requestsPerSecond: limits.stageRequestsPerSecond },
    {
      limit:
        limits.reservedConcurrency === undefined ? "account concurrency" : "reserved concurrency",
      // Concurrency = requests per second x seconds per request. And one execution
      // environment serves at most 10 requests a second, however short they are.
      requestsPerSecond: Math.min(concurrency / workload.durationSeconds, concurrency * 10),
    },
  ];
  if (workload.readUnits > 0) {
    all.push({
      limit: "table read units",
      requestsPerSecond: limits.tableReadUnitsPerSecond / workload.readUnits,
    });
  }
  if (workload.writeUnits > 0) {
    all.push({
      limit: "table write units",
      requestsPerSecond: limits.tableWriteUnitsPerSecond / workload.writeUnits,
    });
  }
  return all.toSorted((a, b) => a.requestsPerSecond - b.requestsPerSecond);
}
// #endregion ceilings
