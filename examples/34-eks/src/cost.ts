import { type NodeSubnets, NODES, WORKLOAD } from "./config.ts";

// #region billable
/** The book's month. data/pricing/scenarios.json uses the same number. */
export const MONTH_HOURS = 730;

/** IDs in data/pricing/unit-prices.json. */
export const PRICE_IDS = {
  clusterHour: "eks.cluster.hour",
  extendedSupportHour: "eks.cluster.extended-support.hour",
  nodeHour: "ec2.t4g-medium.linux.hour",
  autoModeHour: "eks.auto.t4g-medium.hour",
  nodeStorage: "ebs.gp3.storage",
  albHour: "alb.hour",
  publicIpv4Hour: "vpc.public-ipv4.in-use.hour",
} as const;

export type FixedItem = { priceId: string; quantity: number; basis: string };

/** The load balancer has one node, with one public IPv4 address, in each of its two zones. */
const ALB_ZONES = 2;

export type Running = {
  /** False: the stack is deployed and no manifest is applied, so no node and no load balancer exist. */
  workload: boolean;
  nodeSubnets: NodeSubnets;
  /** One per zone while the pods are spread over two zones. */
  nodes: number;
  /** True once the cluster's Kubernetes version has left standard support. */
  extendedSupport: boolean;
};

export const DEFAULT_RUNNING: Running = {
  workload: true,
  nodeSubnets: "public",
  nodes: WORKLOAD.replicas,
  extendedSupport: false,
};

/**
 * What is billed while nobody calls the API. Requests, logs, the image in chapter 12's
 * repository, each node's root volume, and whatever chapter 11 charges for a private
 * route come on top.
 */
export function fixedMonthlyItems(
  running: Running = DEFAULT_RUNNING,
  hours: number = MONTH_HOURS,
): FixedItem[] {
  const items: FixedItem[] = [
    { priceId: PRICE_IDS.clusterHour, quantity: hours, basis: `1 cluster x ${hours} hours` },
  ];
  if (running.extendedSupport) {
    items.push({
      priceId: PRICE_IDS.extendedSupportHour,
      quantity: hours,
      basis: `1 cluster in extended support x ${hours} hours`,
    });
  }
  if (!running.workload) {
    return items;
  }
  const { nodes } = running;
  const addresses = ALB_ZONES + (running.nodeSubnets === "public" ? nodes : 0);
  return [
    ...items,
    {
      priceId: PRICE_IDS.nodeHour,
      quantity: nodes * hours,
      basis: `${nodes} ${NODES.instanceType} nodes x ${hours} hours`,
    },
    {
      priceId: PRICE_IDS.autoModeHour,
      quantity: nodes * hours,
      basis: `${nodes} nodes managed by Auto Mode x ${hours} hours`,
    },
    {
      priceId: PRICE_IDS.nodeStorage,
      quantity: (nodes * NODES.ephemeralStorageGiB * hours) / MONTH_HOURS,
      basis: `${nodes} nodes x ${NODES.ephemeralStorageGiB} GB of ephemeral storage (gp3 assumed)`,
    },
    { priceId: PRICE_IDS.albHour, quantity: hours, basis: `1 load balancer x ${hours} hours` },
    {
      priceId: PRICE_IDS.publicIpv4Hour,
      quantity: addresses * hours,
      basis:
        running.nodeSubnets === "public"
          ? `(${ALB_ZONES} load balancer nodes + ${nodes} nodes) x ${hours} hours`
          : `${ALB_ZONES} load balancer nodes x ${hours} hours`,
    },
  ];
}
// #endregion billable
