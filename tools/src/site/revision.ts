import { execFileSync } from "node:child_process";

/** The object that records which source revision the bucket currently serves. */
export const REVISION_KEY = "aih-revision.json";

/**
 * The commit a build came from. A build of uncommitted changes is marked as
 * such, so that a smoke test never mistakes it for the commit it sits on.
 */
export function sourceRevision(cwd: string): string {
  const git = (...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  try {
    const head = git("rev-parse", "--short=12", "HEAD");
    return git("status", "--porcelain") === "" ? head : `${head}-dirty`;
  } catch {
    return "uncommitted";
  }
}
