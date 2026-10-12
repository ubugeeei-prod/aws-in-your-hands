import { z } from "zod";

// Everything this chapter takes from celld itself, in one file. Each value was
// read from the release, the documentation, or the source at the pinned tag.
// Nothing here was observed on a running node.

// #region releases
export type CelldTarget =
  | "aarch64-unknown-linux-gnu"
  | "x86_64-unknown-linux-gnu"
  | "aarch64-apple-darwin";
type Asset = { file: string; sha256: string; bytes: number };
type Release = { commit: string; assets: Record<CelldTarget, Asset> };

/** SHA-256 of each `.gz` as published, and re-computed from the downloaded files on 2026-10-12. */
export const RELEASES = {
  "v0.6.2": {
    commit: "90b43017241f81189453d326d05948f388b34652",
    assets: {
      "aarch64-unknown-linux-gnu": {
        file: "celld-aarch64-unknown-linux-gnu.gz",
        sha256: "4eca87c6797590000a344c1b768364e9696e8817f5fbc16193f459d2edac7cd0",
        bytes: 24_246_994,
      },
      "x86_64-unknown-linux-gnu": {
        file: "celld-x86_64-unknown-linux-gnu.gz",
        sha256: "ce0ee3552cc8d55dde3998dc3b1b0c8f547bbcb4bc803d2a94842368b047646c",
        bytes: 25_151_812,
      },
      "aarch64-apple-darwin": {
        file: "celld-aarch64-apple-darwin.gz",
        sha256: "b81a38299800679e9651fd7c1544540185682dcb59eed1a24c8cc36c6b31e76d",
        bytes: 22_071_922,
      },
    },
  },
  // Kept only so the lab has something to upgrade from. Only the latest release gets security fixes.
  "v0.6.1": {
    commit: "f2bf648663a610eefde71f3547ad61e9b896b1f0",
    assets: {
      "aarch64-unknown-linux-gnu": {
        file: "celld-aarch64-unknown-linux-gnu.gz",
        sha256: "ab99053bcced225bb5b54f428792260c905b782b8a61947362a12ce3a9c22def",
        bytes: 24_215_735,
      },
      "x86_64-unknown-linux-gnu": {
        file: "celld-x86_64-unknown-linux-gnu.gz",
        sha256: "79a8253cff5d4e8a4a9f7a2611e393390f7fe9025f00e88467875b007c44866b",
        bytes: 25_122_717,
      },
      "aarch64-apple-darwin": {
        file: "celld-aarch64-apple-darwin.gz",
        sha256: "3033cc4f428433f4239ac616a04092cd4b6c7db19f2f5ba9926c86ec56c34c95",
        bytes: 22_043_344,
      },
    },
  },
} as const satisfies Record<string, Release>;

export type CelldVersion = keyof typeof RELEASES;
export const CELLD_VERSIONS = Object.keys(RELEASES) as [CelldVersion, ...CelldVersion[]];
export const PINNED_VERSION: CelldVersion = "v0.6.2";
export const versionSchema = z.enum(CELLD_VERSIONS);

export const RELEASE_BASE_URL = "https://github.com/denoland/celld/releases/download";
export const assetOf = (version: CelldVersion, target: CelldTarget): Asset =>
  RELEASES[version].assets[target];
export const assetUrl = (version: CelldVersion, target: CelldTarget): string =>
  `${RELEASE_BASE_URL}/${version}/${assetOf(version, target).file}`;
// #endregion releases

// #region example-app
/** The upstream `examples/counter` at the pinned tag: one Durable Object that adds 1 on every request. */
export const COUNTER_APP = {
  baseUrl: `https://raw.githubusercontent.com/denoland/celld/${PINNED_VERSION}/examples/counter`,
  files: {
    "index.js": "173088ca56ed4328b887813a8accaa9900c8306c4ab999ea682e93501e83dfc8",
    "wrangler.jsonc": "6b431b363a84b9da425cb52fa70e5c78da99e91b5ad85d9e0314d4cee499966d",
  },
} as const;
// #endregion example-app

// #region documented
/** Defaults and paths the documentation states for v0.6.2. */
export const DOCUMENTED = {
  /** CELLD_TTL_MS: how long a node lease lives. Renewed after a third of it. */
  leaseTtlMs: 10_000,
  /** CELLD_SHUTDOWN_TOTAL_MS: the bound on a graceful stop. The supervisor's stop timeout must be longer. */
  shutdownTotalMs: 40_000,
  /** CELLD_REBALANCE_INTERVAL_MS: every node reads the shared fleet sample this often. */
  fleetSampleMs: 5_000,
  /** CELLD_DEPLOY_POLL_S: every node reads deploy/current.json this often. */
  deployPollSeconds: 30,
  /** The only path celld reserves on the public listener: 200 `{"ok":true}` when healthy, 503 otherwise. */
  healthPath: "/.well-known/celld/health",
  /** Key prefixes celld owns inside the fleet bucket (or inside its key prefix). */
  reservedPrefixes: [
    "probe/",
    "cells/",
    "nodes/",
    "node-cells/",
    "fleet/",
    "deploy/",
    "deploy-blobs/",
    "log/",
    "wake/",
    "telemetry/",
  ],
} as const;
// #endregion documented

// #region upgrade-notes
export type UpgradeMode = "rolling" | "stop-all";
type UpgradeNote = { from: string; to: string; mode: UpgradeMode; condition?: string };

/** The "Upgrade notes" section of the documentation, as data. Read it again before trusting this copy. */
export const UPGRADE_NOTES: readonly UpgradeNote[] = [
  { from: "v0.1.0", to: "v0.2.0", mode: "stop-all" },
  { from: "v0.2.1", to: "v0.3.0", mode: "rolling" },
  { from: "v0.3.0", to: "v0.4.0", mode: "stop-all" },
  { from: "v0.4.0", to: "v0.4.1", mode: "rolling" },
  {
    from: "v0.5.1",
    to: "v0.6.0",
    mode: "stop-all",
    condition: "with fleet durability, which is the default",
  },
  { from: "v0.6.0", to: "v0.6.1", mode: "rolling" },
  { from: "v0.6.1", to: "v0.6.2", mode: "rolling" },
];

export type UpgradeDecision =
  | { mode: UpgradeMode; reason: string }
  | { mode: "unknown"; reason: string };

/** Never guesses: a pair the notes do not list is "unknown", and the caller must stop. */
export function upgradeModeFor(from: string, to: string): UpgradeDecision {
  if (from === to) {
    return {
      mode: "rolling",
      reason: `${to} to itself: a restart, not a format or protocol change`,
    };
  }
  const note = UPGRADE_NOTES.find((candidate) => candidate.from === from && candidate.to === to);
  if (note === undefined) {
    return {
      mode: "unknown",
      reason: `the upgrade notes copied into this chapter do not list ${from} to ${to}`,
    };
  }
  return {
    mode: note.mode,
    reason: `upgrade notes: ${from} to ${to} is ${note.mode}${note.condition === undefined ? "" : ` (${note.condition})`}`,
  };
}
// #endregion upgrade-notes
