// vp run celld:fetch [version] [--host]
//   node scripts/fetch.ts [version] [--host]
//
// Downloads the pinned release archive for the nodes into .celld/download/ and
// checks its size and SHA-256 against src/celld.ts. With --host it also fetches
// the archive for this machine, unpacks it to .celld/bin/celld, and fetches the
// upstream counter example into .celld/app/counter.
//
// Talks to github.com. Touches no AWS account. Runs nothing it downloads.
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { assetOf, assetUrl, type CelldTarget, COUNTER_APP, PINNED_VERSION, versionSchema } from "../src/celld.ts";
import { ARTIFACT_TARGET } from "../src/machine.ts";

const args = process.argv.slice(2);
const host = args.includes("--host");
const version = versionSchema.parse(args.find((argument) => !argument.startsWith("--")) ?? PINNED_VERSION);

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// #region verify
/** Nothing is written under its final name until both the size and the digest match the pinned values. */
async function fetchAsset(target: CelldTarget): Promise<Uint8Array> {
  const asset = assetOf(version, target);
  const bytes = await download(assetUrl(version, target));
  const digest = sha256(bytes);
  if (bytes.byteLength !== asset.bytes || digest !== asset.sha256) {
    throw new Error(
      `${asset.file} for ${version} does not match the pinned release: ${bytes.byteLength} bytes, sha256 ${digest}`,
    );
  }
  const directory = `.celld/download/${version}`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/${asset.file}.partial`, bytes);
  renameSync(`${directory}/${asset.file}.partial`, `${directory}/${asset.file}`);
  console.log(`${directory}/${asset.file}  sha256 ${digest}`);
  return bytes;
}
// #endregion verify

function hostTarget(): CelldTarget {
  const key = `${process.platform}-${process.arch}`;
  const targets: Record<string, CelldTarget> = {
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "darwin-arm64": "aarch64-apple-darwin",
  };
  const target = targets[key];
  if (target === undefined) {
    throw new Error(`celld publishes no binary for ${key}. Deploy the application from a supported machine.`);
  }
  return target;
}

try {
  await fetchAsset(ARTIFACT_TARGET);
  if (host) {
    const archive = await fetchAsset(hostTarget());
    mkdirSync(".celld/bin", { recursive: true });
    writeFileSync(".celld/bin/celld.partial", gunzipSync(archive));
    chmodSync(".celld/bin/celld.partial", 0o755);
    renameSync(".celld/bin/celld.partial", ".celld/bin/celld");
    console.log(`.celld/bin/celld  ${version} (unpacked, not run)`);

    mkdirSync(".celld/app/counter", { recursive: true });
    for (const [file, expected] of Object.entries(COUNTER_APP.files)) {
      const bytes = await download(`${COUNTER_APP.baseUrl}/${file}`);
      if (sha256(bytes) !== expected) {
        throw new Error(`${file} of the counter example does not match the pinned digest`);
      }
      writeFileSync(`.celld/app/counter/${file}`, bytes);
      console.log(`.celld/app/counter/${file}`);
    }
  }
  console.log("Provenance, if you have the GitHub CLI: gh attestation verify <file> --repo denoland/celld");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
