// #region break-even
export type StoragePrices = {
  /** USD per ACU-hour. */
  acuHour: number;
  /** USD per GB-month. */
  storageGbMonth: number;
  /** USD per million I/O requests. Aurora I/O-Optimized has no such charge. */
  ioPerMillion: number;
};

export type MonthlyUsage = { acuHours: number; storageGb: number; ioMillions: number };

export function monthlyCost(usage: MonthlyUsage, prices: StoragePrices): number {
  return (
    usage.acuHours * prices.acuHour +
    usage.storageGb * prices.storageGbMonth +
    usage.ioMillions * prices.ioPerMillion
  );
}

/** Millions of I/O requests a month above which Aurora I/O-Optimized costs less. */
export function breakEvenIoMillions(
  usage: Omit<MonthlyUsage, "ioMillions">,
  standard: StoragePrices,
  ioOptimized: StoragePrices,
): number {
  const premium =
    usage.acuHours * (ioOptimized.acuHour - standard.acuHour) +
    usage.storageGb * (ioOptimized.storageGbMonth - standard.storageGbMonth);
  return premium / standard.ioPerMillion;
}
// #endregion break-even
