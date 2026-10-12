import { describe, expect, it } from "vite-plus/test";

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import {
  breakEvenRequests,
  ec2Items,
  fargateItems,
  lambdaItems,
  monthlyRequests,
} from "../src/breakeven.ts";
import { parseFargateConfig, SCALING } from "../src/config.ts";
import { fixedMonthlyItems } from "../src/cost.ts";
import { type PriceItem, recommendSize, taskItems } from "../src/sizing.ts";

const { prices, allowances, scenarios } = loadPricing();

const scenario = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const total = (id: string) => calculate(scenario(id), prices.prices, allowances);
const cost = (items: PriceItem[]) =>
  calculate(
    {
      id: "test",
      chapter: "41",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items,
    },
    prices.prices,
    allowances,
  );
/** Adds up lines with the same price, as the recorded scenarios do. */
const quantities = (items: { priceId: string; quantity: number }[]): Record<string, number> => {
  const sums: Record<string, number> = {};
  for (const item of items) {
    sums[item.priceId] = (sums[item.priceId] ?? 0) + item.quantity;
  }
  return sums;
};
const usd = (id: string): number =>
  Number(prices.prices.find((price) => price.id === id)?.tiers[0]?.usd);

const running = parseFargateConfig({ imageTag: "f1" });
const small = { cpuUnits: 256, memoryMiB: 512 };
const steady = { requestsPerSecond: 20, busyHoursPerDay: 24, averageMs: 50 };
const spiky = { requestsPerSecond: 20, busyHoursPerDay: 2, averageMs: 50 };

// The chapter quotes these numbers. If a price or the layout changes, the prose must change with it.
describe("what the chapter says the stack costs", () => {
  it("is nothing by the hour until an image tag is given", () => {
    expect(fixedMonthlyItems(parseFargateConfig({}))).toEqual([]);
  });

  it("is 50.35 a month left alone, of which the stack's hourly parts are 50.34", () => {
    const recorded = quantities(scenario("fargate-idle").items);
    const planned = quantities(fixedMonthlyItems(running));
    for (const [priceId, quantity] of Object.entries(planned)) {
      expect(recorded[priceId], priceId).toBeCloseTo(quantity, 9);
    }
    expect(cost(fixedMonthlyItems(running)).listUsd).toBe(50.34);
    expect(total("fargate-idle").listUsd).toBe(50.35);
    expect(total("fargate-idle").afterAllowanceUsd).toBe(50.35);
  });

  it("is 1.65 for one day, and 0.069 for one hour", () => {
    expect(total("fargate-one-day").listUsd).toBe(1.65);
    expect(cost(fixedMonthlyItems(running, SCALING.minTasks, 1)).listUsd).toBe(0.07);
    const hour = cost(fixedMonthlyItems(running, SCALING.minTasks, 1)).lines.reduce(
      (sum, line) => sum + line.listUsd,
      0,
    );
    expect(hour).toBeCloseTo(0.069, 3);
  });

  it("is bounded by 100.93 at the scaling ceiling, each extra task adding 12.65", () => {
    expect(total("fargate-ceiling").listUsd).toBe(100.93);
    const step =
      cost(fixedMonthlyItems(running, SCALING.minTasks + 1)).listUsd -
      cost(fixedMonthlyItems(running)).listUsd;
    expect(step).toBeCloseTo(12.64, 1);
  });

  it("puts the nightly job at about a cent a month", () => {
    const job = fixedMonthlyItems(running).slice(4);
    expect(job.map((item) => item.priceId)).toEqual([
      "fargate.arm.vcpu.hour",
      "fargate.arm.memory.gb-hour",
    ]);
    expect(cost(job).listUsd).toBe(0.01);
  });
});

describe("what the chapter says a task size costs", () => {
  it.each([
    [256, 512, 9.0, 11.25],
    [512, 1024, 17.99, 22.49],
    [512, 4096, 27.67, 34.6],
    [1024, 2048, 35.98, 44.98],
  ])(
    "%i CPU units and %i MiB for a month: %f on arm64, %f on x86",
    (cpuUnits, memoryMiB, arm, x86) => {
      expect(cost(taskItems({ cpuUnits, memoryMiB }, "arm64", 1)).listUsd).toBe(arm);
      expect(cost(taskItems({ cpuUnits, memoryMiB }, "x86_64", 1)).listUsd).toBe(x86);
    },
  );

  it("charges 2.91 a month for 30 GB of ephemeral storage beyond the included 20", () => {
    expect(cost(taskItems(small, "arm64", 1, 730, 50).slice(2)).listUsd).toBe(2.91);
    expect(cost(taskItems(small, "arm64", 1, 730, 200).slice(2)).listUsd).toBe(17.48);
  });

  it("recommends from the same prices the scenarios use", () => {
    const rates = {
      vcpuHour: usd("fargate.arm.vcpu.hour"),
      gbHour: usd("fargate.arm.memory.gb-hour"),
    };
    const { size } = recommendSize(
      { peakCpuUnits: 180, peakMemoryMiB: 410, maxUtilization: 0.7 },
      rates,
    );
    expect(size).toEqual({ cpuUnits: 512, memoryMiB: 1024 });
    expect(cost(taskItems(size, "arm64", 1)).listUsd).toBe(17.99);
  });
});

describe("Fargate against Lambda and EC2", () => {
  it.each([
    ["fargate-vs-steady-lambda", lambdaItems(steady, 512), 94.52, 88.99],
    [
      "fargate-vs-steady-fargate",
      fargateItems(steady, { size: small, alwaysOn: 2, busyOnly: 0 }),
      54.94,
      54.94,
    ],
    ["fargate-vs-steady-ec2", ec2Items(steady, 2, 8), 70.02, 70.02],
    ["fargate-vs-spiky-lambda", lambdaItems(spiky, 512), 7.88, 6.24],
    [
      "fargate-vs-spiky-fargate",
      fargateItems(spiky, { size: small, alwaysOn: 2, busyOnly: 2 }),
      52.79,
      52.79,
    ],
  ])("%s: the scenario is what the function computes", (id, items, list, afterAllowance) => {
    expect(quantities(scenario(id).items)).toEqual(quantities(items));
    expect(total(id).listUsd).toBe(list);
    expect(total(id).afterAllowanceUsd).toBe(afterAllowance);
  });

  it("counts the requests the prose names", () => {
    expect(monthlyRequests(steady)).toBe(51_840_000);
    expect(monthlyRequests(spiky)).toBe(4_320_000);
  });

  it("meets Lambda at about 27.7 million requests a month, a little over ten a second", () => {
    const million = cost(
      lambdaItems({ requestsPerSecond: 1, busyHoursPerDay: 24, averageMs: 50 }, 512).map(
        (item) => ({
          ...item,
          quantity: (item.quantity / monthlyRequests({ ...steady, requestsPerSecond: 1 })) * 1e6,
        }),
      ),
    ).listUsd;
    expect(million).toBe(1.82);
    const even = breakEvenRequests(cost(fixedMonthlyItems(running)).listUsd, million / 1e6);
    expect(even).toBe(27_659_341);
    expect(even / (30 * 86_400)).toBeCloseTo(10.67, 2);
  });

  it("makes two t4g.small instances cost more than two quarter-vCPU tasks, and less than two 1 vCPU tasks", () => {
    const instance = cost([
      { priceId: "ec2.t4g-small.linux.hour", quantity: 730, basis: "" },
      { priceId: "ebs.gp3.storage", quantity: 8, basis: "" },
    ]).listUsd;
    expect(instance).toBe(16.54);
    expect(cost(taskItems(small, "arm64", 1)).listUsd).toBeLessThan(instance);
    expect(
      cost(taskItems({ cpuUnits: 1024, memoryMiB: 2048 }, "arm64", 1)).listUsd,
    ).toBeGreaterThan(instance);
  });
});

describe("the smaller numbers the chapter quotes", () => {
  const line = (priceId: string, quantity: number): number =>
    cost([{ priceId, quantity, basis: "" }]).listUsd;

  it("estimates Container Insights at 11.10 a month from the pricing page's metric counts", () => {
    // 13 per cluster, 14 billed per service, 10 per task definition family: one of each here.
    expect(line("cloudwatch.metric.custom", 13 + 14 + 10)).toBe(11.1);
  });

  it("puts one public IPv4 address at 3.65 a month, and six tasks' worth at 21.90", () => {
    expect(line("vpc.public-ipv4.in-use.hour", 730)).toBe(3.65);
    expect(line("vpc.public-ipv4.in-use.hour", 6 * 730)).toBe(21.9);
  });

  it("puts a NAT gateway with its address at 48.91 a month, as much as thirteen tasks' addresses", () => {
    const nat = cost([
      { priceId: "nat.gateway.hour", quantity: 730, basis: "" },
      { priceId: "vpc.public-ipv4.in-use.hour", quantity: 730, basis: "" },
    ]).listUsd;
    expect(nat).toBe(48.91);
    expect(Math.floor(nat / line("vpc.public-ipv4.in-use.hour", 730))).toBe(13);
  });

  it("puts one more interface endpoint, in two zones, at 20.44 a month", () => {
    expect(line("vpc.endpoint.interface.hour", 2 * 730)).toBe(20.44);
  });
});
