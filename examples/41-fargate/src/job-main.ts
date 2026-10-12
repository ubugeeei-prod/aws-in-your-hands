import { setTimeout as sleep } from "node:timers/promises";

import { EXIT_CODE, parseJobEnv, runJob } from "./job.ts";

// #region main
const env = parseJobEnv(process.env);
const log = (entry: Record<string, unknown>): void =>
  void process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);

// A Spot interruption, a stopped task, and Ctrl-C all end up here.
let stopRequested = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    stopRequested = true;
    log({ level: "info", message: "stop requested", signal });
  });
}

log({ level: "info", message: "started", items: env.JOB_ITEMS, startAt: env.JOB_START_AT });
const result = await runJob({
  items: env.JOB_ITEMS,
  startAt: env.JOB_START_AT,
  work: () => sleep(env.JOB_ITEM_MS),
  stopRequested: () => stopRequested,
  log,
});
// The exit code is the only thing ECS records about how the job went.
process.exitCode = EXIT_CODE[result.status];
// #endregion main
