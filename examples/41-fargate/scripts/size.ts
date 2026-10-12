// vp run fargate:size --cpu 180 --memory 410 [--max-utilization 0.7] [--arch arm64]
//   node scripts/size.ts ...
//
// The cheapest Fargate task size that holds a measured peak, and what a month
// of one such task costs. Reads only data/pricing in this checkout.

import { parseArgs } from "node:util";

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { type Architecture, FARGATE_PRICE_IDS, recommendSize, taskItems } from "../src/sizing.ts";

const { values } = parseArgs({
  options: {
    cpu: { type: "string" },
    memory: { type: "string" },
    "max-utilization": { type: "string", default: "0.7" },
    arch: { type: "string", default: "arm64" },
  },
});

try {
  if (values.cpu === undefined || values.memory === undefined) {
    throw new Error(
      "usage: size.ts --cpu <peak CPU units> --memory <peak MiB> [--max-utilization 0.7] [--arch arm64|x86_64]",
    );
  }
  if (values.arch !== "arm64" && values.arch !== "x86_64") {
    throw new Error("--arch is arm64 or x86_64");
  }
  const architecture: Architecture = values.arch;
  const { prices, allowances } = loadPricing();
  const usd = (id: string): number => {
    const price = prices.prices.find((candidate) => candidate.id === id);
    if (price === undefined) {
      throw new Error(`${id} is missing from data/pricing/unit-prices.json`);
    }
    return Number(price.tiers[0]?.usd);
  };
  const ids = FARGATE_PRICE_IDS[architecture];
  const result = recommendSize(
    {
      peakCpuUnits: Number(values.cpu),
      peakMemoryMiB: Number(values.memory),
      maxUtilization: Number(values["max-utilization"]),
    },
    { vcpuHour: usd(ids.vcpuHour), gbHour: usd(ids.gbHour) },
  );
  const month = calculate(
    {
      id: "size",
      chapter: "41",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items: taskItems(result.size, architecture, 1),
    },
    prices.prices,
    allowances,
  );
  const percent = (share: number): string => `${Math.round(share * 100)} %`;
  console.log(`needed:  ${result.needed.cpuUnits} CPU units, ${result.needed.memoryMiB} MiB`);
  console.log(
    `size:    ${result.size.cpuUnits} CPU units (${result.size.cpuUnits / 1024} vCPU), ${result.size.memoryMiB} MiB`,
  );
  console.log(
    `at peak: CPU ${percent(result.utilizationAtPeak.cpu)}, memory ${percent(result.utilizationAtPeak.memory)}`,
  );
  console.log(
    `price:   USD ${month.listUsd.toFixed(2)} for one ${architecture} task running 730 hours, on demand`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
