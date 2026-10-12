// When a Kubernetes version stops being cheap to stay on.

// #region calendar
export type VersionDates = {
  version: string;
  /** ISO dates (UTC) from the Amazon EKS release calendar. */
  endOfStandardSupport: string;
  endOfExtendedSupport: string;
};

/** Copied from the Amazon EKS release calendar on 2026-10-13. The page changes: read it again. */
export const RELEASE_CALENDAR: VersionDates[] = [
  { version: "1.37", endOfStandardSupport: "2027-12-01", endOfExtendedSupport: "2028-12-01" },
  { version: "1.36", endOfStandardSupport: "2027-08-02", endOfExtendedSupport: "2028-08-02" },
  { version: "1.35", endOfStandardSupport: "2027-03-27", endOfExtendedSupport: "2028-03-27" },
  { version: "1.34", endOfStandardSupport: "2026-12-02", endOfExtendedSupport: "2027-12-02" },
  { version: "1.33", endOfStandardSupport: "2026-07-29", endOfExtendedSupport: "2027-07-29" },
  { version: "1.32", endOfStandardSupport: "2026-03-23", endOfExtendedSupport: "2027-03-23" },
  { version: "1.31", endOfStandardSupport: "2025-11-26", endOfExtendedSupport: "2026-11-26" },
];
// #endregion calendar

// #region status
export type SupportPolicy = "STANDARD" | "EXTENDED";

export type SupportStatus =
  | { phase: "standard"; daysLeft: number }
  | { phase: "extended"; daysLeft: number }
  /** EKS upgrades the cluster by itself: at the end of standard support under STANDARD, of extended under EXTENDED. */
  | { phase: "auto-upgrade" };

const DAY_MS = 24 * 60 * 60 * 1000;
const daysUntil = (date: string, now: Date): number =>
  Math.ceil((Date.parse(`${date}T00:00:00Z`) - now.getTime()) / DAY_MS);

export function supportStatus(
  dates: VersionDates,
  policy: SupportPolicy,
  now: Date,
): SupportStatus {
  const standard = daysUntil(dates.endOfStandardSupport, now);
  if (standard > 0) {
    return { phase: "standard", daysLeft: standard };
  }
  const extended = daysUntil(dates.endOfExtendedSupport, now);
  if (policy === "EXTENDED" && extended > 0) {
    return { phase: "extended", daysLeft: extended };
  }
  return { phase: "auto-upgrade" };
}
// #endregion status

// #region plan
/**
 * EKS moves a cluster one minor version at a time. The versions to pass through, in order,
 * from `from` up to `to`.
 */
export function upgradePath(from: string, to: string): string[] {
  const minor = (version: string): number => {
    const match = /^1\.(\d+)$/.exec(version);
    if (match === null) {
      throw new Error(`"${version}" is not a Kubernetes minor version such as 1.37`);
    }
    return Number(match[1]);
  };
  const [start, end] = [minor(from), minor(to)];
  if (end < start) {
    throw new Error(`${to} is older than ${from}: a cluster is not downgraded this way`);
  }
  return Array.from({ length: end - start }, (_, index) => `1.${start + index + 1}`);
}
// #endregion plan
