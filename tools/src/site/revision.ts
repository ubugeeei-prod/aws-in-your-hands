import { execFileSync } from "node:child_process";

/** Records which source revision the bucket serves. */
export const REVISION_KEY = "aih-revision.json";

/** Uncommitted changes are marked dirty, so a smoke test never mistakes them for the commit. */
export function sourceRevision(cwd: string): string {
  const git = (...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  try {
    const head = git("rev-parse", "--short=12", "HEAD");
    return git("status", "--porcelain") === "" ? head : `${head}-dirty`;
  } catch {
    return "uncommitted";
  }
}
