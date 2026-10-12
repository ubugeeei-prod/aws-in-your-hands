// vp run fargate:image:build <tag> | fargate:image:push <tag>
//   node scripts/image.ts <build|push> <tag> [--dry-run]
//
// Chapter 12's docker commands, run in this directory and pushed to this
// chapter's repository. Both need the docker command and a running Docker
// daemon, which the Nix shell does not provide. --dry-run prints the commands.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { buildSteps, pushSteps, render, type Step } from "@aih/example-12-containers/src/image.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { FARGATE_STACK, parseFargateConfig } from "../src/config.ts";

const { values, positionals } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false } },
  allowPositionals: true,
});
const [action, tagInput] = positionals;
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

try {
  if ((action !== "build" && action !== "push") || tagInput === undefined) {
    throw new Error("usage: image.ts <build|push> <tag> [--dry-run]");
  }
  // The same rule the stack applies to `-c imageTag=...`.
  const tag = parseFargateConfig({ imageTag: tagInput }).imageTag ?? "";

  let steps: Step[];
  if (dryRun) {
    steps =
      action === "build"
        ? buildSteps(tag)
        : pushSteps(
            tag,
            // A placeholder: the real URI is the stack's RepositoryUri output.
            "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/repository-name",
            "ap-northeast-1",
          );
  } else {
    if (action === "build" && !(existsSync("dist/server.mjs") && existsSync("dist/job.mjs"))) {
      throw new Error("dist/ is incomplete. Run `vp run fargate:bundle` first.");
    }
    const daemon = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
    });
    if (daemon.error !== undefined || daemon.status !== 0) {
      throw new Error(
        "No Docker daemon answered. The Nix shell includes neither the docker command nor a daemon: start Docker Desktop, Colima, or similar, then run this again. With --dry-run the commands are printed and not run.",
      );
    }
    if (action === "build") {
      steps = buildSteps(tag);
    } else {
      const { target } = await preflight({
        access: "mutate",
        action: `push image ${tag} to the repository`,
        stack: FARGATE_STACK,
      });
      const uri = requireOutput(
        await readStackOutputs(process.cwd(), FARGATE_STACK, target.region),
        "RepositoryUri",
      );
      steps = pushSteps(tag, uri, target.region);
    }
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
