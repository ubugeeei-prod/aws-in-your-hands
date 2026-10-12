import { describe, expect, it } from "vite-plus/test";

import { TASK } from "@aih/example-12-containers/src/config.ts";

import { allSizes, FARGATE_SIZES, isValidSize } from "../src/sizes.ts";
import { recommendSize, taskItems } from "../src/sizing.ts";

// Tokyo, arm64, on demand. Only the order of sizes depends on these two numbers.
const arm = { vcpuHour: 0.04045, gbHour: 0.00442 };

describe("the Fargate size table", () => {
  it("has the rows the developer guide listed on 2026-10-13", () => {
    expect(FARGATE_SIZES.map((row) => [row.cpuUnits, row.memoryMiB.length])).toEqual([
      [256, 3],
      [512, 4],
      [1024, 7],
      [2048, 13],
      [4096, 23],
      [8192, 12],
      [16384, 12],
      [32768, 3],
    ]);
    expect(FARGATE_SIZES.at(5)?.memoryMiB.slice(0, 3)).toEqual([16384, 20480, 24576]);
    expect(FARGATE_SIZES.at(-1)?.memoryMiB).toEqual([61440, 122880, 249856]);
  });

  it("accepts chapter 12's task and refuses pairs that are not in the table", () => {
    expect(isValidSize({ cpuUnits: TASK.cpuUnits, memoryMiB: TASK.memoryMiB })).toBe(true);
    // More memory needs more CPU with it: a quarter vCPU stops at 2 GB.
    expect(isValidSize({ cpuUnits: 256, memoryMiB: 4096 })).toBe(false);
    // Half a vCPU starts at 1 GB.
    expect(isValidSize({ cpuUnits: 512, memoryMiB: 512 })).toBe(false);
    expect(isValidSize({ cpuUnits: 300, memoryMiB: 1024 })).toBe(false);
    expect(isValidSize({ cpuUnits: 8192, memoryMiB: 18 * 1024 })).toBe(false);
  });
});

describe("recommendSize", () => {
  it("keeps chapter 12's size for a peak that fits it with 30 % to spare", () => {
    const result = recommendSize(
      { peakCpuUnits: 150, peakMemoryMiB: 300, maxUtilization: 0.7 },
      arm,
    );
    expect(result.needed).toEqual({ cpuUnits: 215, memoryMiB: 429 });
    expect(result.size).toEqual({ cpuUnits: 256, memoryMiB: 512 });
  });

  it("moves up when memory alone asks for it, and pays for CPU it did not ask for", () => {
    // 2.5 GB at the peak needs 3.6 GB with headroom. A quarter vCPU stops at 2 GB.
    const result = recommendSize(
      { peakCpuUnits: 100, peakMemoryMiB: 2560, maxUtilization: 0.7 },
      arm,
    );
    expect(result.size).toEqual({ cpuUnits: 512, memoryMiB: 4096 });
    expect(result.utilizationAtPeak.cpu).toBeCloseTo(0.195, 3);
  });

  it("never returns a size that the peak would fill past the stated share", () => {
    for (const peakCpuUnits of [60, 200, 700, 1500, 5000]) {
      for (const peakMemoryMiB of [100, 900, 3000, 20_000]) {
        const { size } = recommendSize({ peakCpuUnits, peakMemoryMiB, maxUtilization: 0.8 }, arm);
        expect(isValidSize(size)).toBe(true);
        expect(peakCpuUnits / size.cpuUnits).toBeLessThanOrEqual(0.8);
        expect(peakMemoryMiB / size.memoryMiB).toBeLessThanOrEqual(0.8);
      }
    }
  });

  it("returns the cheapest size that fits, not the first", () => {
    const measured = { peakCpuUnits: 900, peakMemoryMiB: 1500, maxUtilization: 0.9 };
    const { size } = recommendSize(measured, arm);
    const cost = (candidate: { cpuUnits: number; memoryMiB: number }): number =>
      (candidate.cpuUnits / 1024) * arm.vcpuHour + (candidate.memoryMiB / 1024) * arm.gbHour;
    const fitting = allSizes().filter((s) => s.cpuUnits >= 1000 && s.memoryMiB >= 1667);
    expect(Math.min(...fitting.map(cost))).toBe(cost(size));
    expect(size).toEqual({ cpuUnits: 1024, memoryMiB: 2048 });
  });

  it("says so when nothing in the table is large enough", () => {
    expect(() =>
      recommendSize({ peakCpuUnits: 30_000, peakMemoryMiB: 1000, maxUtilization: 0.7 }, arm),
    ).toThrow(/split the work/);
  });

  it("refuses measurements that cannot be peaks", () => {
    const bad = [
      { peakCpuUnits: 0, peakMemoryMiB: 100, maxUtilization: 0.7 },
      { peakCpuUnits: 100, peakMemoryMiB: Number.NaN, maxUtilization: 0.7 },
      { peakCpuUnits: 100, peakMemoryMiB: 100, maxUtilization: 0 },
      { peakCpuUnits: 100, peakMemoryMiB: 100, maxUtilization: 1.2 },
    ];
    for (const measured of bad) {
      expect(() => recommendSize(measured, arm)).toThrow();
    }
  });
});

describe("taskItems", () => {
  it("bills ephemeral storage only beyond the 20 GiB every task has", () => {
    const size = { cpuUnits: 256, memoryMiB: 512 };
    expect(taskItems(size, "arm64", 2, 730, 20).map((item) => item.priceId)).toEqual([
      "fargate.arm.vcpu.hour",
      "fargate.arm.memory.gb-hour",
    ]);
    expect(taskItems(size, "arm64", 2, 730, 50).at(-1)).toMatchObject({
      priceId: "fargate.ephemeral-storage.gb-hour",
      quantity: 2 * 30 * 730,
    });
  });
});
