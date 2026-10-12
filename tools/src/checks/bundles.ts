// vp run bundles:check
//
// Loads every synthesized Lambda bundle in plain Node, the way Lambda does on a cold start.
// Unit tests cannot catch a bundle that fails to load: vitest supplies its own `require`.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { repoRoot } from "../data/load.ts";

const entryNames = ["index.mjs", "index.js"];

// A module that cannot be loaded at all. Anything else (a missing env var, for one)
// means the bundle loaded and the handler's own start-up code ran.
const loadFailure =
  /Dynamic require of|require is not defined|Cannot find (module|package)|ERR_MODULE_NOT_FOUND|SyntaxError|does not provide an export/;

type Manifest = { files?: Record<string, { source?: { path?: string; packaging?: string } }> };

function cdkOutDirs(): string[] {
  const examples = join(repoRoot, "examples");
  const dirs = readdirSync(examples).flatMap((name) => [
    join(examples, name, "cdk.out"),
    join(examples, name, "infra", "cdk.out"),
  ]);
  return [...dirs, join(repoRoot, "book", "infra", "cdk.out")].filter((dir) => existsSync(dir));
}

/** Only the assets the current templates point at. cdk.out keeps old ones around. */
function currentBundles(cdkOut: string): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(cdkOut).filter((name) => name.endsWith(".assets.json"))) {
    const manifest = JSON.parse(readFileSync(join(cdkOut, file), "utf8")) as Manifest;
    for (const { source } of Object.values(manifest.files ?? {})) {
      if (source?.packaging !== "zip" || source.path === undefined) {
        continue;
      }
      const dir = join(cdkOut, source.path);
      if (entryNames.some((name) => existsSync(join(dir, name)))) {
        found.add(dir);
      }
    }
  }
  return [...found];
}

function load(bundleDir: string): string | undefined {
  // Copied out of the repo: Lambda has no package.json above the bundle, so neither should this.
  const scratch = mkdtempSync(join(tmpdir(), "aih-bundle-"));
  try {
    cpSync(bundleDir, scratch, { recursive: true });
    const entry = entryNames.map((name) => join(scratch, name)).find((path) => existsSync(path));
    const script = `import(${JSON.stringify(entry)}).then(() => process.exit(0), (e) => { console.error(String(e?.stack ?? e)); process.exit(1); });`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: scratch,
      encoding: "utf8",
      timeout: 30_000,
      // No credentials and no real endpoints: start-up code must not reach AWS from here.
      env: {
        PATH: process.env.PATH ?? "",
        AWS_REGION: "ap-northeast-1",
        AWS_EC2_METADATA_DISABLED: "true",
      },
    });
    const output = `${result.stdout}${result.stderr}`;
    return loadFailure.test(output) ? output.trim().split("\n").slice(0, 3).join("\n") : undefined;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

let checked = 0;
const failed: string[] = [];

for (const cdkOut of cdkOutDirs()) {
  for (const bundle of currentBundles(cdkOut)) {
    checked += 1;
    const problem = load(bundle);
    if (problem !== undefined) {
      failed.push(`${relative(repoRoot, bundle)}\n  ${problem.replaceAll("\n", "\n  ")}`);
    }
  }
}

if (checked === 0) {
  console.error("no synthesized bundles found; run `vp run infra:synth` first");
  process.exit(1);
}
if (failed.length > 0) {
  console.error(`${failed.length} of ${checked} bundles do not load:\n\n${failed.join("\n\n")}`);
  process.exit(1);
}
console.log(`bundles check passed: ${checked} bundles load in plain Node`);
