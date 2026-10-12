import * as v from "valibot";

// Everything this chapter takes from YugabyteDB itself, in one file. Each value
// was read from the release page, the documentation, or the pinned archive.

// #region release
export type YugabyteTarget = "darwin-arm64" | "el8-aarch64";
type Asset = { file: string; sha256: string; bytes: number };

/**
 * v2025.2 is the long-term support series. The SHA-256 values are the ones the
 * vendor publishes next to each archive (`<archive>.sha`), read on 2026-10-13.
 * Only the darwin-arm64 archive was downloaded and re-hashed here.
 */
export const RELEASE = {
  version: "2025.2.7.0",
  build: "b107",
  assets: {
    "darwin-arm64": {
      file: "yugabyte-2025.2.7.0-b107-darwin-arm64.tar.gz",
      sha256: "4a6a23f6d2acfb61ba270d7397472cb6dec5144ec05d97d99b929e8cf8edde49",
      bytes: 130_180_590,
    },
    "el8-aarch64": {
      file: "yugabyte-2025.2.7.0-b107-el8-aarch64.tar.gz",
      sha256: "73fbe3b9ef2093a0385f452ce1a67f79f78967c97b7abdad581f86992fe33be2",
      bytes: 479_462_171,
    },
  },
} as const satisfies { version: string; build: string; assets: Record<YugabyteTarget, Asset> };

export const RELEASE_BASE_URL = "https://software.yugabyte.com/releases";
export const assetOf = (target: YugabyteTarget): Asset => RELEASE.assets[target];
export const assetUrl = (target: YugabyteTarget): string =>
  `${RELEASE_BASE_URL}/${RELEASE.version}/${assetOf(target).file}`;
/** The directory the archive unpacks to. */
export const UNPACKED_DIRECTORY = `yugabyte-${RELEASE.version}`;
// #endregion release

// #region documented
/** Defaults the documentation states for the two server processes. */
export const DOCUMENTED = {
  ports: {
    masterRpc: 7100,
    masterWeb: 7000,
    tserverRpc: 9100,
    tserverWeb: 9000,
    ysql: 5433,
    ysqlWeb: 13000,
  },
  /** `replication_factor`: copies of every tablet, and of the master's own catalog. */
  replicationFactor: 3,
  /** `max_clock_skew_usec`: a node whose clock is further off than this crashes on purpose. */
  maxClockSkewMicros: 500_000,
  /** `follower_unavailable_considered_failed_sec`: after this a dead peer's tablets are re-replicated elsewhere. */
  followerFailedAfterSeconds: 900,
} as const;
// #endregion documented

/** `major.minor.patch.build`, the form every YugabyteDB release number has. */
export const versionSchema = v.pipe(v.string(), v.regex(/^\d{4}\.\d+\.\d+\.\d+$/));
