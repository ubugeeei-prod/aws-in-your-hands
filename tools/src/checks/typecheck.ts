// vp run typecheck
//
// Type-checks every TypeScript project in the workspace with `tsc --noEmit`.
//
// --singleThreaded is deliberate. With TypeScript 7.0.2's default parallel
// checking, the same unchanged sources intermittently fail with errors such as
// "Module 'aws-cdk-lib/assertions' has no exported member 'Match'": an import
// of one aws-cdk-lib subpath is resolved to another one. `vp check`'s built-in
// type check showed the same behavior (it failed 2 of 5 identical runs here),
// which is why this task, not `vp check`, is the type check of record.
// A check that sometimes fails on correct code teaches people to rerun it.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { repoRoot } from "../data/load.ts";

// The Vue app in examples/03-spa/src is checked by `vp run typecheck:vue`
// (Vize), which understands .vue files. Its CDK code is checked here.
const projects = [
  ".",
  "book",
  "book/infra",
  "tools",
  "examples/02-toolchain",
  "examples/03-spa/infra",
  "examples/04-http-api",
  "examples/05-dynamodb",
  "examples/06-auth",
];

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
