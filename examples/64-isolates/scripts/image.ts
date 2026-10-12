// vp run isolates:image:build <tag> | isolates:image:push <tag>
//   node scripts/image.ts <build|push> <tag> [--dry-run]
//
// Both actions need the docker command and a running Docker daemon. The Nix
// shell provides neither. --dry-run prints the commands and runs none of them.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { render, type Step } from "@aih/example-12-containers/src/image.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { ISOLATES_STACK, parseIsolatesConfig } from "../src/config.ts";
import { buildSteps, pushSteps } from "../src/image.ts";

const { values, positionals } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, "repository-uri": { type: "string" } },
  allowPositionals: true,
});
const [action, tagInput] = positionals;
const dryRun = values["dry-run"];

/** What the Dockerfile copies. A build without one of them would fail halfway, with a worse message. */
const INPUTS = {
  ".workerd/linux-arm64/workerd": "vp run isolates:fetch",
  "dist/config.capnp": "vp run isolates:bundle",
  "dist/notes.mjs": "vp run isolates:bundle",
};

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
  const tag = parseIsolatesConfig({ imageTag: tagInput }).imageTag ?? "";

  if (!dryRun) {
    if (action === "build") {
      for (const [file, task] of Object.entries(INPUTS)) {
        if (!existsSync(file)) {
          throw new Error(`${file} is missing. Run \`${task}\` first.`);
        }
      }
    }
    const daemon = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
    });
    if (daemon.error !== undefined || daemon.status !== 0) {
      throw new Error(
        "No Docker daemon answered. The Nix shell includes neither the docker command nor a daemon: start Docker Desktop, Colima, or similar, then run this again. With --dry-run the commands are printed and not run.",
      );
    }
  }

  let steps: Step[];
  if (action === "build") {
    steps = buildSteps(tag);
  } else if (dryRun && values["repository-uri"] === undefined) {
    console.error(
      "# 123456789012 and the repository name are placeholders; the real URI is the stack's RepositoryUri",
    );
    steps = pushSteps(
      tag,
      "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/repository-name",
      "ap-northeast-1",
    );
  } else {
    let uri = values["repository-uri"];
    let region = "ap-northeast-1";
    if (uri === undefined) {
      const { target } = await preflight({
        access: "mutate",
        action: `push image ${tag} to the repository`,
        stack: ISOLATES_STACK,
      });
      region = target.region;
      uri = requireOutput(
        await readStackOutputs(process.cwd(), ISOLATES_STACK, region),
        "RepositoryUri",
      );
    }
    steps = pushSteps(tag, uri, region);
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
