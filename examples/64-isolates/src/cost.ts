import { fixedMonthlyItems, type FixedItem } from "@aih/example-12-containers/src/cost.ts";

import { type IsolatesConfig, SERVICE } from "./config.ts";

export const MONTH_HOURS = 730;
const MONTH_SECONDS = MONTH_HOURS * 3600;

// #region idle
/** What the stack is billed for while nobody calls it: chapter 12's arithmetic, with this chapter's task count. */
export const idleItems = (config: IsolatesConfig, hours: number = MONTH_HOURS): FixedItem[] =>
  fixedMonthlyItems(config, SERVICE.desiredCount, hours);
// #endregion idle

// #region load
/** A month of traffic, described the way Cloudflare's pricing page describes its examples. */
export type Load = { requests: number; cpuMsPerRequest: number };

/** What the load adds on Fargate: only the load balancer's capacity units. The task costs the same busy or idle. */
export function loadItems(load: Load, hours: number = MONTH_HOURS): FixedItem[] {
  // One new connection per request, and 25 new connections a second per LCU, as in chapter 12.
  const lcu = load.requests / MONTH_SECONDS / 25;
  return [
    {
      priceId: "alb.lcu.hour",
      quantity: Math.round(lcu * hours * 10) / 10,
      basis: `${lcu.toFixed(3)} LCU x ${hours} hours (assumption: one new connection per request)`,
    },
  ];
}

/** The share of one task's CPU the load takes on average. Above 1, one task is not enough. Peaks are not in it. */
export const averageCpuShare = (load: Load, vcpu: number): number =>
  (load.requests * load.cpuMsPerRequest) / 1000 / MONTH_SECONDS / vcpu;

/** The same load on chapter 04's stack: HTTP API in front of a 256 MB arm64 function. */
export function lambdaItems(load: Load, durationSeconds: number, memoryGb: number): FixedItem[] {
  return [
    { priceId: "apigw.http.request", quantity: load.requests, basis: "one HTTP API request each" },
    { priceId: "lambda.request.arm", quantity: load.requests, basis: "one invocation per request" },
    {
      priceId: "lambda.duration.arm",
      quantity: load.requests * durationSeconds * memoryGb,
      basis: `${load.requests} x ${durationSeconds} s x ${memoryGb} GB, in GB-seconds`,
    },
  ];
}
// #endregion load

// #region workers
/**
 * Cloudflare's Workers Paid plan, Standard usage model, as its pricing page stated it on
 * 2026-10-13 (the page was last updated on 2026-10-02). Not an AWS price, so it is not in data/pricing.
 */
export const WORKERS_STANDARD = {
  monthlyUsd: 5,
  includedRequests: 10_000_000,
  usdPerMillionRequests: 0.3,
  includedCpuMs: 30_000_000,
  usdPerMillionCpuMs: 0.02,
} as const;

export function workersStandardUsd(load: Load): number {
  const plan = WORKERS_STANDARD;
  const over = (used: number, included: number): number => Math.max(0, used - included) / 1e6;
  const usd =
    plan.monthlyUsd +
    over(load.requests, plan.includedRequests) * plan.usdPerMillionRequests +
    over(load.requests * load.cpuMsPerRequest, plan.includedCpuMs) * plan.usdPerMillionCpuMs;
  return Math.round(usd * 100) / 100;
}
// #endregion workers
