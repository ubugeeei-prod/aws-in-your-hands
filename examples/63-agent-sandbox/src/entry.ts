// The container's program: runs one job and exits. Bundled to dist/entry.mjs for the image.

import { spawn } from "node:child_process";

import * as v from "valibot";

import { type Exec, runJob, taskEnvironmentSchema } from "./run.ts";

// Output goes straight to the task's stdout, and from there to CloudWatch Logs.
const exec: Exec = (argv, options) =>
  new Promise((resolve) => {
    const [program = "", ...args] = argv;
    const child = spawn(program, args, { cwd: options.cwd, env: options.env, stdio: "inherit" });
    let timedOut = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            // Claude Code ends its Bash commands and exits on SIGTERM.
            child.kill("SIGTERM");
          }, options.timeoutMs);
    child.on("error", () => resolve({ code: null, timedOut }));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut });
    });
  });

const environment = v.safeParse(taskEnvironmentSchema, process.env);
if (!environment.success) {
  const fields = environment.issues.map((issue) => v.getDotPath(issue) ?? "(root)");
  console.log(JSON.stringify({ event: "job", status: "failed", step: "environment", fields }));
  process.exit(2);
}

const outcome = await runJob(environment.output, {
  exec,
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  inherited: process.env,
});
console.log(JSON.stringify({ event: "job", jobId: environment.output.JOB_ID, ...outcome }));
process.exit(outcome.status === "pull_request" || outcome.status === "no_changes" ? 0 : 1);
