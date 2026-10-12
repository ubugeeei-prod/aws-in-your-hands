// #region tally
export type Sample = { status: number; version: string; flagsOrigin: string };

export type Tally = {
  total: number;
  /** Per version: how many answers it gave, and how many of them were 5xx. */
  versions: Record<string, { answers: number; serverErrors: number }>;
  flagsOrigins: Record<string, number>;
};

export function tally(samples: Sample[]): Tally {
  const result: Tally = { total: samples.length, versions: {}, flagsOrigins: {} };
  for (const sample of samples) {
    const version = (result.versions[sample.version] ??= { answers: 0, serverErrors: 0 });
    version.answers += 1;
    version.serverErrors += sample.status >= 500 ? 1 : 0;
    result.flagsOrigins[sample.flagsOrigin] = (result.flagsOrigins[sample.flagsOrigin] ?? 0) + 1;
  }
  return result;
}

export function formatTally(result: Tally): string[] {
  const share = (count: number) => `${((count / Math.max(result.total, 1)) * 100).toFixed(1)}%`;
  return [
    ...Object.entries(result.versions)
      .toSorted(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
      .map(
        ([version, { answers, serverErrors }]) =>
          `version ${version}: ${answers} of ${result.total} (${share(answers)}), ${serverErrors} with 5xx`,
      ),
    `flags: ${Object.entries(result.flagsOrigins)
      .map(([origin, count]) => `${origin} ${count}`)
      .join(", ")}`,
  ];
}
// #endregion tally
