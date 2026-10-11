// vp run sources:pack
//
// Writes artifacts/aws-in-your-hands-<revision>.tar.gz from the committed
// tree, with a SHA-256 next to it. It packs HEAD, not the working directory,
// so the archive is exactly what the revision name says it is.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../data/load.ts";

const git = (...args: string[]): string => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();

let revision: string;
try {
  revision = git("rev-parse", "--short=12", "HEAD");
} catch {
  console.error("There is no commit to pack yet. Commit the tree first.");
  process.exit(1);
}
if (git("status", "--porcelain") !== "") {
  console.error("The working tree has uncommitted changes. The archive would not contain them; commit or stash first.");
  process.exit(1);
}

const name = `aws-in-your-hands-${revision}`;
const directory = join(repoRoot, "artifacts");
const archive = join(directory, `${name}.tar.gz`);
mkdirSync(directory, { recursive: true });
execFileSync("git", ["archive", "--format=tar.gz", `--prefix=${name}/`, "-o", archive, "HEAD"], { cwd: repoRoot });

const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(`${archive}.sha256`, `${digest}  ${name}.tar.gz\n`);
console.log(`${archive}\nsha256 ${digest}\nfiles  ${git("ls-tree", "-r", "--name-only", "HEAD").split("\n").length}`);
