import { TASK } from "@aih/example-12-containers/src/config.ts";
import { fixedMonthlyItems as serviceItems } from "@aih/example-12-containers/src/cost.ts";

import { type FargateConfig, SCALING } from "./config.ts";
import { MONTH_HOURS, type PriceItem, taskItems } from "./sizing.ts";

// #region billable
/** Fargate bills a task by the second, with a one-minute minimum. */
export const MINIMUM_BILLED_SECONDS = 60;

/**
 * What the stack is billed for while nobody calls it. The service part is chapter 12's
 * arithmetic with this chapter's task count; the nightly job is priced at the
 * on-demand rate, because the Spot rate is not in the Price List.
 */
export function fixedMonthlyItems(
  config: FargateConfig,
  tasks: number = SCALING.minTasks,
  hours: number = MONTH_HOURS,
  jobSeconds: number = MINIMUM_BILLED_SECONDS,
): PriceItem[] {
  if (config.imageTag === undefined) {
    return [];
  }
  // One run a night; a 730-hour month has 30 of them here.
  const runs = Math.round((hours / MONTH_HOURS) * 30);
  const billedSeconds = Math.max(jobSeconds, MINIMUM_BILLED_SECONDS);
  const size = { cpuUnits: TASK.cpuUnits, memoryMiB: TASK.memoryMiB };
  const job = taskItems(size, "arm64", runs, billedSeconds / 3600).map((item) => ({
    ...item,
    basis: `nightly job: ${runs} runs x ${billedSeconds} s, ${item.basis}`,
  }));
  // Scheduler and the job's public address round to nothing at this scale and are left to the scenario.
  return [...serviceItems(config, tasks, hours), ...job];
}
// #endregion billable
