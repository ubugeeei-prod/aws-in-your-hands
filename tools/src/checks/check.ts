import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "../data/load.ts";
import { lintGroups } from "./lint-groups.ts";

const run = (args: string[]): void => {
  const result = spawnSync("vp", args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const extra = process.argv.slice(2);
if (!process.env["CI"] || extra.length > 0) {
  run(["check", ...extra]);
} else {
  run(["check", "--no-lint"]);

  // The CDK lint plugin retains one TypeScript backend per project until exit.
  // Separate processes keep all chapters within the hosted runner's memory.
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter((path) => path !== "" && existsSync(join(repoRoot, path)));

  for (const group of lintGroups(paths)) {
    console.log(`lint: ${group.name}`);
    run(["lint", "--no-error-on-unmatched-pattern", ...group.paths.map((path) => `./${path}`)]);
  }
}
