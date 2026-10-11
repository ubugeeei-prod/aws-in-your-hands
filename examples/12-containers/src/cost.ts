import { type ContainersConfig, SERVICE, TASK } from "./config.ts";

// #region billable
/** The book's month. data/pricing/scenarios.json uses the same number. */
export const MONTH_HOURS = 730;

/** IDs in data/pricing/unit-prices.json. */
export const PRICE_IDS = {
  fargateVcpuHour: "fargate.arm.vcpu.hour",
  fargateMemoryHour: "fargate.arm.memory.gb-hour",
  albHour: "alb.hour",
  publicIpv4Hour: "vpc.public-ipv4.in-use.hour",
} as const;

export type FixedItem = { priceId: string; quantity: number; basis: string };

/** The load balancer has one node, with one public IPv4 address, in each of its two zones. */
const ALB_ZONES = 2;

/**
 * What the stack is billed for while nobody calls it, with `tasks` tasks running.
 * Requests, logs, image storage, and whatever chapter 11 charges for a private route come on top.
 */
export function fixedMonthlyItems(
  config: ContainersConfig,
  tasks: number = SERVICE.desiredCount,
  hours: number = MONTH_HOURS,
): FixedItem[] {
  if (config.imageTag === undefined) {
    // Only the repository exists. Its storage is billed by size, not by the hour.
    return [];
  }
  const vcpu = TASK.cpuUnits / 1024;
  const memoryGb = TASK.memoryMiB / 1024;
  const addresses = ALB_ZONES + (config.taskSubnets === "public" ? tasks : 0);
  return [
    {
      priceId: PRICE_IDS.fargateVcpuHour,
      quantity: tasks * vcpu * hours,
      basis: `${tasks} tasks x ${vcpu} vCPU x ${hours} hours`,
    },
    {
      priceId: PRICE_IDS.fargateMemoryHour,
      quantity: tasks * memoryGb * hours,
      basis: `${tasks} tasks x ${memoryGb} GB x ${hours} hours`,
    },
    { priceId: PRICE_IDS.albHour, quantity: hours, basis: `1 load balancer x ${hours} hours` },
    {
      priceId: PRICE_IDS.publicIpv4Hour,
      quantity: addresses * hours,
      basis:
        config.taskSubnets === "public"
          ? `(${ALB_ZONES} load balancer nodes + ${tasks} tasks) x ${hours} hours`
          : `${ALB_ZONES} load balancer nodes x ${hours} hours`,
    },
  ];
}
// #endregion billable
