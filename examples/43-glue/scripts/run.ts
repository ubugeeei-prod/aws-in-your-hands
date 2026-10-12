// vp run glue:run                                    yesterday and the day before (AWS: BILLED)
// vp run glue:run --days 2026-10-10,2026-10-11       named days
//   node scripts/run.ts [--days <day>[,<day>…]]
//
// Starts one run of the job and waits for it to end. A run is billed for two
// DPUs by the second, for one minute at least.

import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { DPU_PER_WORKER, dpuHours, MINIMUM_BILLED_SECONDS } from "../src/cost.ts";
import { JOB } from "../src/job.ts";
import { planDays } from "../src/layout.ts";

const STACK = "AihGlue";
const startedSchema = v.object({ JobRunId: v.string() });
const runSchema = v.object({
  JobRun: v.object({
    JobRunState: v.string(),
    ExecutionTime: v.optional(v.number()),
    ErrorMessage: v.optional(v.string()),
  }),
});

function aws(args: string[]): unknown {
  const result = spawnSync("aws", [...args, "--output", "json"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`aws ${args.slice(0, 2).join(" ")} failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

try {
  const { values } = parseArgs({ options: { days: { type: "string" } } });
  // Checked here as well: the script in AWS takes the days as they come.
  const days = planDays(values.days ?? "auto", new Date());
  console.log(`days: ${days.join(", ")}`);

  const { target } = await preflight({
    access: "mutate",
    action: "start a run of the Glue job (billed per DPU-second; replaces the days' folders)",
    stack: STACK,
  });
  const jobName = requireOutput(
    await readStackOutputs(process.cwd(), STACK, target.region),
    "JobName",
  );
  const { JobRunId: id } = v.parse(
    startedSchema,
    aws([
      "glue",
      "start-job-run",
      "--region",
      target.region,
      "--job-name",
      jobName,
      "--arguments",
      JSON.stringify({ "--days": days.join(",") }),
    ]),
  );
  console.log(`run: ${id}`);

  // The job's own timeout ends the run. Five minutes more are for starting and stopping.
  const deadline = Date.now() + (JOB.timeoutMinutes + 5) * 60_000;
  while (Date.now() < deadline) {
    await sleep(15_000);
    const { JobRun: run } = v.parse(
      runSchema,
      aws([
        "glue",
        "get-job-run",
        "--region",
        target.region,
        "--job-name",
        jobName,
        "--run-id",
        id,
      ]),
    );
    if (["STARTING", "RUNNING", "STOPPING", "WAITING"].includes(run.JobRunState)) {
      continue;
    }
    console.log(`state: ${run.JobRunState} ${run.ErrorMessage ?? ""}`.trimEnd());
    if (run.ExecutionTime !== undefined) {
      const billed = dpuHours({
        dpus: JOB.workers * DPU_PER_WORKER[JOB.workerType],
        seconds: run.ExecutionTime,
        minimumSeconds: MINIMUM_BILLED_SECONDS.job,
      });
      console.log(
        `execution time: ${String(run.ExecutionTime)} s; ${String(billed)} DPU-hours if that is the time billed`,
      );
    }
    process.exit(run.JobRunState === "SUCCEEDED" ? 0 : 1);
  }
  throw new Error(`run ${id} did not end in ${String(JOB.timeoutMinutes + 5)} minutes`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
