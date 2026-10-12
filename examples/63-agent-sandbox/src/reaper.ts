import { estimateUsd, reap, startOfUtcDay, type Stop } from "./limits.ts";
import type { Ports, Settings } from "./ports.ts";

export type SweepResult = { stopped: Stop[]; failed: { taskArn: string; error: string }[] };

// #region sweep
/** Stops what has run too long or spent too much. Runs once a minute, outside every task. */
export async function sweep(ports: Ports, settings: Pick<Settings, "model">): Promise<SweepResult> {
  const tasks = await ports.runningTasks();
  if (tasks.length === 0) {
    // Nothing to stop, so nothing to measure: an idle sandbox makes no metric call.
    return { stopped: [], failed: [] };
  }
  const now = ports.now();
  const spentTodayUsd = estimateUsd(
    await ports.tokensSince(startOfUtcDay(now), now),
    settings.model,
  );

  const result: SweepResult = { stopped: [], failed: [] };
  for (const stop of reap(tasks, now, spentTodayUsd)) {
    try {
      await ports.stopTask(stop.taskArn, `agent sandbox: ${stop.reason}`);
      result.stopped.push(stop);
    } catch (error) {
      // One task that will not stop must not keep the others running.
      result.failed.push({
        taskArn: stop.taskArn,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
// #endregion sweep
