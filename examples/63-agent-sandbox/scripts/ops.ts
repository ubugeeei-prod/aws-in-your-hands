// vp run sandbox:image:build <tag> | sandbox:image:push <tag>
// vp run sandbox:launch <owner/name> "<task>" [--minutes n] [--budget usd] [--base branch]
// vp run sandbox:logs | sandbox:exec <task id>
//   node scripts/ops.ts <image-build|image-push|launch|logs|exec> ... [--dry-run]
//
// --dry-run prints the commands with placeholder names and calls nothing.
// image-build and image-push need a Docker daemon, which the Nix shell does not provide.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import {
  buildSteps,
  execSteps,
  launchSteps,
  logSteps,
  pushSteps,
  render,
  type Step,
} from "../src/commands.ts";
import { parseSandboxConfig, REGION, SANDBOX_STACK } from "../src/config.ts";

const { values, positionals } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    minutes: { type: "string" },
    budget: { type: "string" },
    base: { type: "string" },
  },
  allowPositionals: true,
});
const [action, first, second] = positionals;
const dryRun = values["dry-run"];

function run(step: Step): Promise<number> {
  console.error(`# ${step.title}\n$ ${render(step)}`);
  if (dryRun) {
    return Promise.resolve(0);
  }
  return new Promise((resolve) => {
    const [command = "", ...args] = step.command;
    const child = spawn(command, args, {
      stdio: [step.input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    });
    child.once("error", () => resolve(127));
    child.once("exit", (code) => resolve(code ?? 1));
    if (step.input !== undefined) {
      // The registry password goes through a pipe, never through an argument.
      const [source = "", ...sourceArgs] = step.input;
      const feeder = spawn(source, sourceArgs, { stdio: ["ignore", "pipe", "inherit"] });
      feeder.once("error", () => child.kill());
      feeder.stdout.pipe(child.stdin ?? process.stdout);
    }
  });
}

const PLACEHOLDERS: Record<string, string> = {
  RepositoryUri: "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/repository-name",
  LauncherFunctionName: "launcher-function-name",
  TaskLogGroupName: "task-log-group-name",
  ClusterName: "cluster-name",
};

async function output(
  name: string,
  description: string,
  access: "observe" | "mutate",
): Promise<{ value: string; region: string }> {
  if (dryRun) {
    console.error("# the names below are placeholders; a real run reads them from the stack");
    return { value: PLACEHOLDERS[name] ?? name, region: REGION };
  }
  const { target } = await preflight({ access, action: description, stack: SANDBOX_STACK });
  const outputs = await readStackOutputs(process.cwd(), SANDBOX_STACK, target.region);
  return { value: requireOutput(outputs, name), region: target.region };
}

try {
  let steps: Step[];
  if (action === "image-build" && first !== undefined) {
    const tag = parseSandboxConfig({ imageTag: first }).imageTag ?? "";
    if (!dryRun && !(existsSync("dist/entry.mjs") && existsSync("dist/settings.json"))) {
      throw new Error("dist/ is incomplete. Run `vp run sandbox:bundle` first.");
    }
    steps = buildSteps(tag);
  } else if (action === "image-push" && first !== undefined) {
    const tag = parseSandboxConfig({ imageTag: first }).imageTag ?? "";
    const uri = await output("RepositoryUri", `push image ${tag} to the repository`, "mutate");
    steps = pushSteps(tag, uri.value, uri.region);
  } else if (action === "launch" && first !== undefined && second !== undefined) {
    const launcher = await output(
      "LauncherFunctionName",
      "start one agent task (billed while it runs)",
      "mutate",
    );
    steps = launchSteps(launcher.value, launcher.region, {
      // A new ID for every run of this command. Repeat a request by passing the same payload yourself.
      requestId: randomUUID(),
      repository: first,
      task: second,
      ...(values.base === undefined ? {} : { baseBranch: values.base }),
      ...(values.minutes === undefined ? {} : { minutes: Number(values.minutes) }),
      ...(values.budget === undefined ? {} : { budgetUsd: Number(values.budget) }),
    });
  } else if (action === "logs") {
    const group = await output("TaskLogGroupName", "read the tasks' log", "observe");
    steps = logSteps(group.value, group.region);
  } else if (action === "exec" && first !== undefined) {
    const cluster = await output("ClusterName", "open a shell in a running task", "mutate");
    steps = execSteps(cluster.value, cluster.region, first);
  } else {
    throw new Error(
      'usage: ops.ts image-build <tag> | image-push <tag> | launch <owner/name> "<task>" | logs | exec <task id>',
    );
  }
  for (const step of steps) {
    const code = await run(step);
    if (code !== 0) {
      process.exit(code);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
