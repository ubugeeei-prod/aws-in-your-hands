// What the deployed site must show, as functions of what was observed.

import { NO_STORE, SHARED } from "../core/cache-control.ts";

export type Observed = { status: number; headers: Record<string, string>; body: string };

// #region spec
const servedFromCache = (observed: Observed): boolean =>
  (observed.headers["x-cache"] ?? "").toLowerCase().startsWith("hit") ||
  observed.headers["age"] !== undefined;

/** A public page: labelled shareable, free of cookies, and actually reused by CloudFront. */
export function publicPageProblem(first: Observed, later: Observed[]): string | null {
  for (const observed of [first, ...later]) {
    if (observed.status !== 200) {
      return `expected 200, got ${observed.status}`;
    }
    if (observed.headers["cache-control"] !== SHARED) {
      return `expected cache-control "${SHARED}", got "${observed.headers["cache-control"] ?? "(none)"}"`;
    }
    if (observed.headers["set-cookie"] !== undefined) {
      return "a public page set a cookie";
    }
  }
  return later.some(servedFromCache) ? null : "CloudFront never answered from its cache";
}

/** A personal path: never reused, however often it is asked for, with or without a cookie. */
export function personalPageProblem(observations: Observed[]): string | null {
  for (const observed of observations) {
    if (observed.status !== 200) {
      return `expected 200, got ${observed.status}`;
    }
    if (observed.headers["cache-control"] !== NO_STORE) {
      return `expected cache-control "${NO_STORE}", got "${observed.headers["cache-control"] ?? "(none)"}"`;
    }
    if (servedFromCache(observed)) {
      return `CloudFront answered from its cache (x-cache: ${observed.headers["x-cache"] ?? "(none)"})`;
    }
  }
  return null;
}

/** The function URL itself, asked without CloudFront's signature. */
export const directUrlProblem = (observed: Observed): string | null =>
  observed.status === 403
    ? null
    : `the function URL answered ${observed.status} to an unsigned request`;

export const refusedProblem = (observed: Observed): string | null =>
  observed.status >= 400 && observed.status < 500
    ? null
    : `expected a 4xx refusal, got ${observed.status}`;
// #endregion spec

/** Found from a page, because the names change with every build. */
export function firstAssetPath(pageBody: string): string | undefined {
  return /(?:href|src)="(\/_nuxt\/[^"]+)"/.exec(pageBody)?.[1];
}
