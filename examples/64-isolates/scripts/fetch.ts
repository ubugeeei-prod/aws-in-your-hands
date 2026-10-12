// vp run isolates:fetch
//   node scripts/fetch.ts
//
// Downloads the pinned workerd for Linux arm64 from the npm registry, checks its size and
// digest against src/release.ts, and unpacks the binary to .workerd/linux-arm64/workerd,
// where the Dockerfile picks it up. Talks to registry.npmjs.org. Touches no AWS account.
// Runs nothing it downloads.

import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";

import { checkArchive, WORKERD } from "../src/release.ts";

const directory = ".workerd/linux-arm64";
const archivePath = `${directory}/workerd.tgz`;

try {
  const { url, member } = WORKERD.linuxArm64;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  // #region verify
  // Nothing is unpacked, and nothing is left under its final name, unless the bytes are the pinned ones.
  checkArchive(archive);
  mkdirSync(`${directory}/unpacked`, { recursive: true });
  writeFileSync(archivePath, archive);
  const tar = spawnSync("tar", ["-xzf", archivePath, "-C", `${directory}/unpacked`, member], {
    stdio: "inherit",
  });
  if (tar.status !== 0) {
    throw new Error(`tar could not unpack ${member}`);
  }
  renameSync(`${directory}/unpacked/${member}`, `${directory}/workerd`);
  // #endregion verify
  rmSync(`${directory}/unpacked`, { recursive: true, force: true });
  rmSync(archivePath);
  console.log(
    `${directory}/workerd  ${WORKERD.version}, ${statSync(`${directory}/workerd`).size} bytes (unpacked, not run)`,
  );
} catch (error) {
  rmSync(archivePath, { force: true });
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
