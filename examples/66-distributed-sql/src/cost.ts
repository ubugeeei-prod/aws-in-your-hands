import type { ClusterConfig } from "./config.ts";
import { DOCUMENTED, RELEASE } from "./yugabyte.ts";

// What the stack is billed for, as lines for tools/src/pricing/calc.ts. The
// quantities come from the stack's settings; the prices are in data/pricing/.

export type Item = { priceId: string; quantity: number; basis: string };
export const MONTH_HOURS = 730;

const PRICE_OF_INSTANCE = {
  "t4g.medium": "ec2.t4g-medium.linux.hour",
  "m7g.large": "ec2.m7g-large.linux.hour",
} as const;

/** The image decides the root volume's size. 8 GiB is assumed, not looked up. */
export const ASSUMED_ROOT_GIB = 8;
/** Session Manager and Run Command reach a private subnet through these three. */
export const SSM_ENDPOINTS = 3;

// #region fixed
/** Everything billed whether or not a query runs. */
export function fixedItems(
  config: ClusterConfig,
  state: "running" | "destroyed",
  endpointZones: number,
): Item[] {
  if (config.nodes === 0) {
    return [];
  }
  if (state === "destroyed") {
    return config.stateOnDestroy === "retain"
      ? [
          {
            priceId: "ebs.gp3.storage",
            quantity: config.nodes * config.dataVolumeGiB,
            basis: `${config.nodes} retained data volumes x ${config.dataVolumeGiB} GiB`,
          },
        ]
      : [];
  }
  return [
    {
      priceId: PRICE_OF_INSTANCE[config.instanceType],
      quantity: config.nodes * MONTH_HOURS,
      basis: `${config.nodes} ${config.instanceType} x ${MONTH_HOURS} hours`,
    },
    {
      priceId: "ebs.gp3.storage",
      quantity: config.nodes * (ASSUMED_ROOT_GIB + config.dataVolumeGiB),
      basis: `${config.nodes} x (${ASSUMED_ROOT_GIB} GiB root, assumed + ${config.dataVolumeGiB} GiB data)`,
    },
    ...(endpointZones === 0
      ? []
      : [
          {
            priceId: "vpc.endpoint.interface.hour",
            quantity: SSM_ENDPOINTS * endpointZones * MONTH_HOURS,
            basis: `${SSM_ENDPOINTS} interface endpoints x ${endpointZones} zones x ${MONTH_HOURS} hours`,
          },
        ]),
  ];
}
// #endregion fixed

// #region transfer
export type WriteLoad = { writesPerSecond: number; bytesPerWrite: number };

/**
 * GB metered as regional data transfer in a month, for replication alone. A
 * tablet leader sends each write to its two followers, which are in the two
 * other zones, and AWS meters a transfer between zones at both ends.
 */
export function replicationTransferGb(load: WriteLoad): number {
  const followers = DOCUMENTED.replicationFactor - 1;
  const bytes = load.writesPerSecond * load.bytesPerWrite * 3600 * MONTH_HOURS;
  const meteredEnds = 2;
  return (bytes * followers * meteredEnds) / 1e9;
}

export function transferItem(load: WriteLoad): Item {
  return {
    priceId: "datatransfer.regional",
    quantity: replicationTransferGb(load),
    basis: `${load.writesPerSecond} writes/s x ${load.bytesPerWrite} bytes x ${MONTH_HOURS} hours, to 2 followers, metered out and in`,
  };
}
// #endregion transfer

/** The archive the nodes install from, kept in the bucket. */
export const artifactItem = (): Item => ({
  priceId: "s3.standard.storage",
  quantity: Math.round((RELEASE.assets["el8-aarch64"].bytes / 1e9) * 100) / 100,
  basis: "the release archive for the nodes",
});

// #region managed
/** Chapter 13's assumptions for Aurora DSQL, applied to the same load. Not measured. */
export const DSQL_DPU = { read: 0.00675, write: 0.18525 } as const;

export function dsqlItems(load: {
  writesPerSecond: number;
  readsPerSecond: number;
  storedGb: number;
}): Item[] {
  const seconds = 3600 * MONTH_HOURS;
  const dpu =
    load.writesPerSecond * seconds * DSQL_DPU.write + load.readsPerSecond * seconds * DSQL_DPU.read;
  return [
    {
      priceId: "dsql.dpu",
      quantity: Math.round(dpu),
      basis: `${load.writesPerSecond} writes/s x ${DSQL_DPU.write} DPU + ${load.readsPerSecond} reads/s x ${DSQL_DPU.read} DPU, for ${MONTH_HOURS} hours`,
    },
    { priceId: "dsql.storage", quantity: load.storedGb, basis: `${load.storedGb} GB stored` },
  ];
}
// #endregion managed
