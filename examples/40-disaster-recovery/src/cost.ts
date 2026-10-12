import type { DrConfig } from "./config.ts";
import { ownEndpoints } from "./network.ts";

// #region billable
/** The book's month. data/pricing/scenarios.json uses the same number. */
export const MONTH_HOURS = 730;

/** What chapter 23 creates: an 8 GiB root volume (its assumption) and an 8 GiB data volume. */
export const SOURCE_DISK_GIB = 16;

/** IDs in data/pricing/unit-prices.json. */
export const PRICE_IDS = {
  drsServerHour: "drs.source-server.hour",
  replicationServerHour: "ec2.t3-small.linux.hour",
  stagingDiskGbMonth: "ebs.magnetic.storage",
  snapshotGbMonth: "ebs.snapshot.storage",
  gp3GbMonth: "ebs.gp3.storage",
  recoveryInstanceHour: "ec2.t4g-micro.linux.hour",
  interfaceEndpointHour: "vpc.endpoint.interface.hour",
  publicIpv4Hour: "vpc.public-ipv4.in-use.hour",
} as const;

export type FixedItem = { priceId: string; quantity: number; basis: string };

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * What protecting one source server is billed for over `hours`, with no drill running.
 * Not here because the amount is unknown: incremental snapshots, the replication server's own
 * root volume, I/O requests on magnetic volumes, endpoint data processing, data transfer
 * between zones, and surplus CPU credits of the t3 replication server.
 */
export function protectionItems(
  config: Pick<DrConfig, "placement">,
  hours: number = MONTH_HOURS,
): FixedItem[] {
  const share = hours / MONTH_HOURS;
  const items: FixedItem[] = [
    {
      priceId: PRICE_IDS.drsServerHour,
      quantity: hours,
      basis: `1 replicating source server x ${hours} hours`,
    },
    {
      priceId: PRICE_IDS.replicationServerHour,
      quantity: hours,
      basis: `1 t3.small replication server x ${hours} hours`,
    },
    {
      priceId: PRICE_IDS.stagingDiskGbMonth,
      quantity: round(SOURCE_DISK_GIB * share),
      basis: `${SOURCE_DISK_GIB} GiB of staging disks (magnetic), ${hours} of ${MONTH_HOURS} hours`,
    },
    {
      priceId: PRICE_IDS.snapshotGbMonth,
      quantity: round(SOURCE_DISK_GIB * share),
      basis: `base snapshots the size of the source disks, ${SOURCE_DISK_GIB} GB, ${hours} of ${MONTH_HOURS} hours`,
    },
  ];
  const endpoints = ownEndpoints(config.placement).length;
  if (endpoints > 0) {
    items.push({
      priceId: PRICE_IDS.interfaceEndpointHour,
      quantity: endpoints * hours,
      basis: `${endpoints} interface endpoints (drs, ec2) x 1 zone x ${hours} hours`,
    });
  } else {
    // Without endpoints the replication server reaches the service through a public address.
    items.push({
      priceId: PRICE_IDS.publicIpv4Hour,
      quantity: hours,
      basis: `1 public IPv4 address on the replication server x ${hours} hours`,
    });
  }
  return items;
}

/** What one drill adds while its instance exists. The conversion server is not priced. */
export function drillItems(config: Pick<DrConfig, "placement">, hours: number): FixedItem[] {
  const items: FixedItem[] = [
    {
      priceId: PRICE_IDS.recoveryInstanceHour,
      quantity: hours,
      basis: `1 t4g.micro drill instance x ${hours} hours`,
    },
    {
      priceId: PRICE_IDS.gp3GbMonth,
      quantity: round((SOURCE_DISK_GIB * hours) / MONTH_HOURS),
      // The launch template decides the volume type. gp3 is this chapter's assumption.
      basis: `${SOURCE_DISK_GIB} GiB of volumes (gp3 assumed), ${hours} of ${MONTH_HOURS} hours`,
    },
  ];
  if (config.placement === "public") {
    items.push({
      priceId: PRICE_IDS.publicIpv4Hour,
      quantity: hours,
      basis: `1 public IPv4 address on the drill instance x ${hours} hours`,
    });
  }
  return items;
}
// #endregion billable
