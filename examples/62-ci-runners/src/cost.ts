import { RUNNER } from "./config.ts";

export type PriceItem = { priceId: string; quantity: number; basis: string };

// #region hosted
/**
 * GitHub's published rates per minute for its own standard Linux runners, read on 2026-10-13.
 * Not AWS prices, so they are here and not in data/pricing/. GitHub rounds each job up to a minute.
 */
export const HOSTED_USD_PER_MINUTE = { linuxArm64: 0.005, linuxX64: 0.006 } as const;
// #endregion hosted

// #region job
/** What one job costs on Fargate: the task from image pull to exit, and its public address. */
export function jobItems(jobs: number, taskMinutes: number): PriceItem[] {
  // Fargate bills by the second with a one-minute minimum.
  const hours = (jobs * Math.max(taskMinutes, 1)) / 60;
  const vcpu = RUNNER.cpuUnits / 1024;
  const gb = RUNNER.memoryMiB / 1024;
  return [
    {
      priceId: "fargate.arm.vcpu.hour",
      quantity: vcpu * hours,
      basis: `${jobs} jobs x ${taskMinutes} min x ${vcpu} vCPU`,
    },
    {
      priceId: "fargate.arm.memory.gb-hour",
      quantity: gb * hours,
      basis: `${jobs} jobs x ${taskMinutes} min x ${gb} GB`,
    },
    {
      priceId: "vpc.public-ipv4.in-use.hour",
      quantity: hours,
      basis: `${jobs} jobs x ${taskMinutes} min, one address per task`,
    },
  ];
}
// #endregion job

// #region idle
/** What the stack costs in a month in which no job runs: two secrets, and the sweeper waking up. */
export function idleItems(monthHours: number): PriceItem[] {
  const sweeps = (monthHours * 60) / RUNNER.sweepMinutes;
  return [
    { priceId: "secretsmanager.secret", quantity: 2, basis: "webhook secret and app private key" },
    {
      priceId: "lambda.request.arm",
      quantity: sweeps,
      basis: `one sweep every ${RUNNER.sweepMinutes} min`,
    },
    {
      priceId: "lambda.duration.arm",
      // 256 MB for an assumed one second per sweep.
      quantity: sweeps * 0.25,
      basis: `${sweeps} sweeps x 1 s (assumed) x 0.25 GB`,
    },
    { priceId: "scheduler.invocation", quantity: sweeps, basis: `${sweeps} invocations` },
  ];
}
// #endregion idle

/** The hosted price for the same jobs: every job rounded up to whole minutes. */
export function hostedUsd(jobs: number, jobMinutes: number, perMinute: number): number {
  return jobs * Math.ceil(jobMinutes) * perMinute;
}

// #region break-even
/**
 * The hosted minutes a month above which runners of your own cost less, given the minutes
 * the plan includes. `ownPerJobMinute` is what a minute of job costs on your side, start-up included.
 */
export function breakEvenMinutes(
  includedMinutes: number,
  hostedPerMinute: number,
  ownPerJobMinute: number,
): number {
  if (ownPerJobMinute >= hostedPerMinute) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.ceil((includedMinutes * hostedPerMinute) / (hostedPerMinute - ownPerJobMinute));
}
// #endregion break-even
