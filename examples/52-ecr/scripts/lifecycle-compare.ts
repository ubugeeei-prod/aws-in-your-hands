// vp run ecr:lifecycle:compare
//   node scripts/lifecycle-compare.ts
//
// Asks ECR to preview the stack's lifecycle policy on the real repository and
// compares the answer with this chapter's evaluator. Deletes nothing: a preview
// only reports. Needs credentials.

import { spawnSync } from "node:child_process";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { ECR_STACK } from "../src/config.ts";
import { disagreements, previewSchema, toImages } from "../src/describe.ts";
import { evaluate } from "../src/lifecycle.ts";
import { POLICY } from "../src/policy.ts";

function aws(args: string[]): unknown {
  console.error(`$ aws ${args.join(" ")}`);
  const result = spawnSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`aws ${args[1]} exited with ${result.status}`);
  }
  return result.stdout.trim() === "" ? undefined : JSON.parse(result.stdout);
}

try {
  const { target } = await preflight({
    access: "observe",
    action: "preview the lifecycle policy",
    stack: ECR_STACK,
  });
  const name = requireOutput(
    await readStackOutputs(process.cwd(), ECR_STACK, target.region),
    "RepositoryName",
  );
  const on = ["--repository-name", name, "--region", target.region];

  const images = toImages(aws(["ecr", "describe-images", ...on]));
  const now = new Date();
  aws([
    "ecr",
    "start-lifecycle-policy-preview",
    ...on,
    "--lifecycle-policy-text",
    JSON.stringify(POLICY),
  ]);
  aws(["ecr", "wait", "lifecycle-policy-preview-complete", ...on]);
  const preview = v.parse(previewSchema, aws(["ecr", "get-lifecycle-policy-preview", ...on]));

  const lines = disagreements(evaluate(POLICY, images, now), preview);
  if (lines.length > 0) {
    console.error(`The evaluator and ECR disagree on ${lines.length} of ${images.length} images:`);
    console.error(lines.join("\n"));
    process.exit(1);
  }
  console.log(`The evaluator and ECR agree on all ${images.length} images.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
