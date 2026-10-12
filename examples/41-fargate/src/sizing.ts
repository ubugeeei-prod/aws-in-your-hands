import { allSizes, EPHEMERAL, type TaskSize } from "./sizes.ts";

/** The book's month. data/pricing/scenarios.json uses the same number. */
export const MONTH_HOURS = 730;

export type Architecture = "arm64" | "x86_64";

/** IDs in data/pricing/unit-prices.json. */
export const FARGATE_PRICE_IDS = {
  arm64: { vcpuHour: "fargate.arm.vcpu.hour", gbHour: "fargate.arm.memory.gb-hour" },
  x86_64: { vcpuHour: "fargate.x86.vcpu.hour", gbHour: "fargate.x86.memory.gb-hour" },
  ephemeralGbHour: "fargate.ephemeral-storage.gb-hour",
} as const;

/** USD per vCPU-hour and per GB-hour, as numbers. Only used to order sizes; totals go through the calculator. */
export type Rates = { vcpuHour: number; gbHour: number };

export const hourlyUsd = (size: TaskSize, rates: Rates): number =>
  (size.cpuUnits / 1024) * rates.vcpuHour + (size.memoryMiB / 1024) * rates.gbHour;

// #region recommend
export type Measured = {
  /** The highest CPU the task used, in CPU units (Container Insights reports CpuUtilized in these). */
  peakCpuUnits: number;
  /** The highest memory the task used, in MiB. */
  peakMemoryMiB: number;
  /** How full the task may be at that peak: 0.7 leaves 30 % of the size unused. */
  maxUtilization: number;
};

export type Recommendation = {
  size: TaskSize;
  /** What the peak has to fit into, before rounding up to a size that exists. */
  needed: TaskSize;
  /** Share of the chosen size in use at the measured peak. */
  utilizationAtPeak: { cpu: number; memory: number };
};

/** The cheapest size in the table that holds the measured peak with the stated headroom. */
export function recommendSize(measured: Measured, rates: Rates): Recommendation {
  const { peakCpuUnits, peakMemoryMiB, maxUtilization } = measured;
  if (!(peakCpuUnits > 0) || !(peakMemoryMiB > 0)) {
    throw new Error("the measured peaks have to be positive numbers");
  }
  if (!(maxUtilization > 0 && maxUtilization <= 1)) {
    throw new Error("maxUtilization has to be above 0 and at most 1");
  }
  const needed = {
    cpuUnits: Math.ceil(peakCpuUnits / maxUtilization),
    memoryMiB: Math.ceil(peakMemoryMiB / maxUtilization),
  };
  const candidates = allSizes()
    .filter((size) => size.cpuUnits >= needed.cpuUnits && size.memoryMiB >= needed.memoryMiB)
    // Cheapest first. Two sizes at one price: the one with less CPU, then less memory.
    .toSorted(
      (a, b) =>
        hourlyUsd(a, rates) - hourlyUsd(b, rates) ||
        a.cpuUnits - b.cpuUnits ||
        a.memoryMiB - b.memoryMiB,
    );
  const [size] = candidates;
  if (size === undefined) {
    throw new Error(
      `no Fargate size holds ${needed.cpuUnits} CPU units and ${needed.memoryMiB} MiB: split the work across tasks`,
    );
  }
  return {
    size,
    needed,
    utilizationAtPeak: {
      cpu: peakCpuUnits / size.cpuUnits,
      memory: peakMemoryMiB / size.memoryMiB,
    },
  };
}
// #endregion recommend

// #region items
export type PriceItem = { priceId: string; quantity: number; basis: string };

/** What `tasks` tasks of one size are billed for running `hours` hours, as lines for the price calculator. */
export function taskItems(
  size: TaskSize,
  architecture: Architecture,
  tasks: number,
  hours: number = MONTH_HOURS,
  ephemeralGiB: number = EPHEMERAL.includedGiB,
): PriceItem[] {
  const ids = FARGATE_PRICE_IDS[architecture];
  const vcpu = size.cpuUnits / 1024;
  const memoryGb = size.memoryMiB / 1024;
  const items: PriceItem[] = [
    {
      priceId: ids.vcpuHour,
      quantity: tasks * vcpu * hours,
      basis: `${tasks} tasks x ${vcpu} vCPU x ${hours} hours`,
    },
    {
      priceId: ids.gbHour,
      quantity: tasks * memoryGb * hours,
      basis: `${tasks} tasks x ${memoryGb} GB x ${hours} hours`,
    },
  ];
  // Only what was configured beyond the included 20 GiB is billed.
  const extra = ephemeralGiB - EPHEMERAL.includedGiB;
  if (extra > 0) {
    items.push({
      priceId: FARGATE_PRICE_IDS.ephemeralGbHour,
      quantity: tasks * extra * hours,
      basis: `${tasks} tasks x ${extra} GB beyond the included ${EPHEMERAL.includedGiB} x ${hours} hours`,
    });
  }
  return items;
}
// #endregion items
