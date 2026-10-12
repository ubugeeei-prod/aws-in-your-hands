// vp run distsql:fetch            the archive for this machine, unpacked
// vp run distsql:fetch --nodes    also the archive for the EC2 nodes, not unpacked
//   node scripts/fetch.ts [--nodes]
//
// Downloads the pinned YugabyteDB archive into .yugabyte/download/, checks its
// size and SHA-256 against src/yugabyte.ts, and unpacks the one for this
// machine into .yugabyte/dist/. Talks to software.yugabyte.com (which redirects
// to downloads.yugabyte.com). Touches no AWS account. Starts nothing.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";

import { assetOf, assetUrl, UNPACKED_DIRECTORY, type YugabyteTarget } from "../src/yugabyte.ts";

function hostTarget(): YugabyteTarget {
  const key = `${process.platform}-${process.arch}`;
  if (key === "darwin-arm64") {
    return "darwin-arm64";
  }
  if (key === "linux-arm64") {
    return "el8-aarch64";
  }
  throw new Error(`src/yugabyte.ts pins no archive for ${key}.`);
}

// #region verify
/** Nothing is unpacked until both the size and the digest match the pinned values. */
async function fetchArchive(target: YugabyteTarget): Promise<string> {
  const asset = assetOf(target);
  const path = `.yugabyte/download/${asset.file}`;
  if (existsSync(path)) {
    return path;
  }
  const response = await fetch(assetUrl(target), { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${assetUrl(target)} answered ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== asset.bytes || digest !== asset.sha256) {
    throw new Error(
      `${asset.file} does not match the pinned release: ${bytes.byteLength} bytes, sha256 ${digest}`,
    );
  }
  mkdirSync(".yugabyte/download", { recursive: true });
  writeFileSync(`${path}.partial`, bytes);
  renameSync(`${path}.partial`, path);
  console.log(`${path}  sha256 ${digest}`);
  return path;
}
// #endregion verify

try {
  if (process.argv.includes("--nodes")) {
    await fetchArchive("el8-aarch64");
  }
  const archive = await fetchArchive(hostTarget());
  const home = `.yugabyte/dist/${UNPACKED_DIRECTORY}`;
  if (existsSync(`${home}/bin/yb-master`)) {
    console.log(`${home} is already unpacked`);
  } else {
    rmSync(".yugabyte/dist", { recursive: true, force: true });
    mkdirSync(".yugabyte/dist", { recursive: true });
    execFileSync("tar", ["-xzf", archive, "-C", ".yugabyte/dist"], { stdio: "inherit" });
    console.log(`${home}  (unpacked, not started)`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
