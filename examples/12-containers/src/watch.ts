/** One request to the service. Status 0: no HTTP response arrived. */
export type Sample = { status: number; version: string };

/** What a watch saw: answers per version, and whether anything other than 200 came back. */
export function summarize(samples: readonly Sample[]): string[] {
  const perVersion = new Map<string, number>();
  for (const sample of samples.filter((item) => item.status === 200)) {
    perVersion.set(sample.version, (perVersion.get(sample.version) ?? 0) + 1);
  }
  const failed = samples.filter((sample) => sample.status !== 200).length;
  return [
    `${samples.length} requests`,
    ...[...perVersion].map(([version, count]) => `  ${version}: ${count} x 200`),
    failed === 0 ? "  no request failed" : `  ${failed} failed`,
  ];
}
