import type { TaskSize } from "./sizes.ts";
import { MONTH_HOURS, type PriceItem, taskItems } from "./sizing.ts";

// #region workload
export type Workload = {
  requestsPerSecond: number;
  /** Hours a day the requests arrive. The rest of the day nothing does. */
  busyHoursPerDay: number;
  /** Average time a request takes, in milliseconds. */
  averageMs: number;
};

const DAYS = 30;
/** An Application Load Balancer counts 25 new connections a second as one LCU. */
const NEW_CONNECTIONS_PER_LCU = 25;
/** Two load balancer nodes, each with a public IPv4 address. */
const ALB_ADDRESSES = 2;

export const monthlyRequests = (workload: Workload): number =>
  workload.requestsPerSecond * 3600 * workload.busyHoursPerDay * DAYS;
// #endregion workload

// #region lambda
/** Chapter 04's shape: an HTTP API in front of an arm64 function. */
export function lambdaItems(workload: Workload, memoryMb: number): PriceItem[] {
  const requests = monthlyRequests(workload);
  const gbSeconds = requests * (workload.averageMs / 1000) * (memoryMb / 1024);
  return [
    { priceId: "apigw.http.request", quantity: requests, basis: `${requests} requests` },
    { priceId: "lambda.request.arm", quantity: requests, basis: `${requests} requests` },
    {
      priceId: "lambda.duration.arm",
      quantity: gbSeconds,
      basis: `${requests} requests x ${workload.averageMs} ms x ${memoryMb / 1024} GB`,
    },
  ];
}
// #endregion lambda

// #region fargate
export type Fleet = {
  size: TaskSize;
  /** Tasks that run all month. */
  alwaysOn: number;
  /** Tasks that auto scaling adds for the busy hours only. */
  busyOnly: number;
};

/** Chapter 12's shape: tasks in public subnets behind an Application Load Balancer. */
export function fargateItems(workload: Workload, fleet: Fleet): PriceItem[] {
  const busyHours = workload.busyHoursPerDay * DAYS;
  const lcuHours = (workload.requestsPerSecond / NEW_CONNECTIONS_PER_LCU) * busyHours;
  const addressHours = (ALB_ADDRESSES + fleet.alwaysOn) * MONTH_HOURS + fleet.busyOnly * busyHours;
  const merged = new Map<string, PriceItem>();
  for (const item of [
    ...taskItems(fleet.size, "arm64", fleet.alwaysOn, MONTH_HOURS),
    ...(fleet.busyOnly > 0 ? taskItems(fleet.size, "arm64", fleet.busyOnly, busyHours) : []),
  ]) {
    const known = merged.get(item.priceId);
    merged.set(
      item.priceId,
      known === undefined
        ? item
        : {
            priceId: item.priceId,
            quantity: known.quantity + item.quantity,
            basis: `${known.basis} + ${item.basis}`,
          },
    );
  }
  return [
    ...merged.values(),
    { priceId: "alb.hour", quantity: MONTH_HOURS, basis: `1 load balancer x ${MONTH_HOURS} hours` },
    {
      priceId: "alb.lcu.hour",
      quantity: Number(lcuHours.toFixed(6)),
      basis: `${workload.requestsPerSecond} new connections/s / ${NEW_CONNECTIONS_PER_LCU} x ${busyHours} hours`,
    },
    {
      priceId: "vpc.public-ipv4.in-use.hour",
      quantity: addressHours,
      basis: `(${ALB_ADDRESSES} load balancer nodes + ${fleet.alwaysOn} tasks) x ${MONTH_HOURS} hours + ${fleet.busyOnly} tasks x ${busyHours} hours`,
    },
  ];
}
// #endregion fargate

// #region ec2
/** Chapter 23's shape, twice: two t4g.small instances with an 8 GB volume each, behind the same load balancer. */
export function ec2Items(workload: Workload, instances: number, volumeGb: number): PriceItem[] {
  const busyHours = workload.busyHoursPerDay * DAYS;
  const lcuHours = (workload.requestsPerSecond / NEW_CONNECTIONS_PER_LCU) * busyHours;
  return [
    {
      priceId: "ec2.t4g-small.linux.hour",
      quantity: instances * MONTH_HOURS,
      basis: `${instances} instances x ${MONTH_HOURS} hours`,
    },
    {
      priceId: "ebs.gp3.storage",
      quantity: instances * volumeGb,
      basis: `${instances} volumes x ${volumeGb} GB`,
    },
    { priceId: "alb.hour", quantity: MONTH_HOURS, basis: `1 load balancer x ${MONTH_HOURS} hours` },
    {
      priceId: "alb.lcu.hour",
      quantity: Number(lcuHours.toFixed(6)),
      basis: `${workload.requestsPerSecond} new connections/s / ${NEW_CONNECTIONS_PER_LCU} x ${busyHours} hours`,
    },
    {
      priceId: "vpc.public-ipv4.in-use.hour",
      quantity: (ALB_ADDRESSES + instances) * MONTH_HOURS,
      basis: `(${ALB_ADDRESSES} load balancer nodes + ${instances} instances) x ${MONTH_HOURS} hours`,
    },
  ];
}
// #endregion ec2

// #region even
/**
 * Requests a month at which a fixed monthly bill and a per-request price meet.
 * Both numbers come out of the price calculator; this is only the division.
 */
export const breakEvenRequests = (fixedMonthlyUsd: number, usdPerRequest: number): number =>
  Math.round(fixedMonthlyUsd / usdPerRequest);
// #endregion even
