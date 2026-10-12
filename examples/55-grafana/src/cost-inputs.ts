// The quantities the pricing scenario of this chapter uses. A test ties them to the
// generated dashboard, so a panel added later changes the number in data/pricing too.

import { type Dashboard, queriedMetrics } from "./schema.ts";

// #region inputs
/** Metrics asked of GetMetricData each time the whole dashboard reloads. */
export function metricsPerRefresh(dashboard: Dashboard): number {
  return queriedMetrics(dashboard).length;
}

/** How often an open dashboard reloads, from its `refresh` such as "1m". */
export function refreshSeconds(dashboard: Dashboard): number {
  const match = /^(\d+)([smhd])$/.exec(dashboard.refresh);
  if (match === null) {
    throw new Error(`unreadable refresh interval: ${dashboard.refresh}`);
  }
  const unit = { s: 1, m: 60, h: 3600, d: 86_400 }[match[2] as "s" | "m" | "h" | "d"];
  return Number(match[1]) * unit;
}

export type Viewing = { hoursPerDay: number; daysPerMonth: number };

/** Metrics requested in a month by one browser tab that keeps the dashboard open. */
export function metricsRequestedPerMonth(dashboard: Dashboard, viewing: Viewing): number {
  const refreshes = (viewing.hoursPerDay * viewing.daysPerMonth * 3600) / refreshSeconds(dashboard);
  return refreshes * metricsPerRefresh(dashboard);
}
// #endregion inputs
