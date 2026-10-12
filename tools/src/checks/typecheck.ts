// vp run typecheck
//
// One tsc run per project, so a failure names the project it belongs to.
// (Type checks used to fail at random here. The cause was pnpm hard-linking
// identical files to one inode; see packageImportMethod in pnpm-workspace.yaml.)

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "../data/load.ts";

// examples/03-spa/src (Vue) goes through `vp run typecheck:vue`. Its CDK code is checked here.
const projects = JSON.parse(
  readFileSync(new URL("./typecheck-projects.json", import.meta.url), "utf8"),
) as string[];

const tsc = join(repoRoot, "node_modules/.bin/tsc");
const failed: string[] = [];

for (const project of projects) {
  const result = spawnSync(tsc, ["--noEmit", "-p", join(repoRoot, project)], { stdio: "inherit" });
  console.log(`${result.status === 0 ? "ok  " : "FAIL"} ${project}`);
  if (result.status !== 0) {
    failed.push(project);
  }
}

if (failed.length > 0) {
  console.error(`type errors in: ${failed.join(", ")}`);
  process.exit(1);
}
