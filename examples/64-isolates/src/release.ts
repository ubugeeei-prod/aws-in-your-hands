import { createHash } from "node:crypto";

// #region release
/**
 * The one workerd this chapter runs. `version` is also the devDependency in package.json,
 * which brings the binary for the machine you develop on. The image needs the Linux arm64
 * one, whatever that machine is, so its package is pinned here by size and digest.
 */
export const WORKERD = {
  version: "1.20261012.1",
  /** The newest compatibility date this version knows: its version number is that date. */
  compatibilityDate: "2026-10-12",
  linuxArm64: {
    url: "https://registry.npmjs.org/@cloudflare/workerd-linux-arm64/-/workerd-linux-arm64-1.20261012.1.tgz",
    bytes: 39_889_339,
    /** `dist.integrity` in the npm registry, re-computed from the downloaded file on 2026-10-13. */
    integrity:
      "sha512-I0VMdcXk7ygG5vYDce0ePTBFdnBXC0i9WiBY5mWiv0iTinbfea6/rHqSQ7B1UMpjgrYVs9E0m4bZ9ufsk5GCFA==",
    /** Where the binary sits inside the archive. */
    member: "package/bin/workerd",
  },
} as const;

/** Throws unless `archive` is, byte for byte, the pinned package. */
export function checkArchive(archive: Uint8Array): void {
  const { bytes, integrity } = WORKERD.linuxArm64;
  const actual = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  if (archive.byteLength !== bytes || actual !== integrity) {
    throw new Error(
      `the archive is not workerd ${WORKERD.version} for linux-arm64: ${archive.byteLength} bytes, ${actual}`,
    );
  }
}
// #endregion release
