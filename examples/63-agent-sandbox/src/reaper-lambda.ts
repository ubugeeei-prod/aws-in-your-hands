import { awsPorts } from "./aws.ts";
import { readFunctionEnv } from "./env.ts";
import { sweep, type SweepResult } from "./reaper.ts";

const env = readFunctionEnv(process.env);
const ports = awsPorts(env);

export async function handler(): Promise<SweepResult> {
  const result = await sweep(ports, { model: env.MODEL });
  if (result.stopped.length > 0 || result.failed.length > 0) {
    console.log(JSON.stringify({ event: "sweep", ...result }));
  }
  if (result.failed.length > 0) {
    // An error the function's own metric shows: a task that should be stopped is still running.
    throw new Error(`could not stop ${result.failed.length} task(s)`);
  }
  return result;
}
