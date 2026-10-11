// vp run typecheck
//
// --singleThreaded on purpose: TypeScript 7.0.2's parallel checker intermittently
// resolves one aws-cdk-lib subpath as another on unchanged sources. `vp check`
// did too (2 of 5 identical runs). A flaky check teaches people to rerun it.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../data/load.ts";

// examples/03-spa/src (Vue) goes through `vp run typecheck:vue`. Its CDK code is checked here.
const projects = JSON.parse(readFileSync(new URL("./typecheck-projects.json", import.meta.url), "utf8")) as string[];

const tsc = join(repoRoot, "node_modules/.bin/tsc");
const failed: string[] = [];

for (const project of projects) {
  const result = spawnSync(tsc, ["--noEmit", "--singleThreaded", "-p", join(repoRoot, project)], { stdio: "inherit" });
  console.log(`${result.status === 0 ? "ok  " : "FAIL"} ${project}`);
  if (result.status !== 0) {
    failed.push(project);
  }
}

if (failed.length > 0) {
  console.error(`type errors in: ${failed.join(", ")}`);
  process.exit(1);
}
