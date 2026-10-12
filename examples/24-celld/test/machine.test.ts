import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  assetOf,
  DOCUMENTED,
  PINNED_VERSION,
  RELEASES,
  UPGRADE_NOTES,
  upgradeModeFor,
} from "../src/celld.ts";
import {
  ARTIFACT_TARGET,
  type NodeSpec,
  nodeSpec,
  nodeSpecSchema,
  renderedFiles,
  renderInstallScript,
  renderUnit,
  renderUserData,
  USER_DATA_LIMIT_BYTES,
} from "../src/machine.ts";

const spec = nodeSpec();
const setting = (unit: string, key: string): string | undefined =>
  new RegExp(`^${key}=(.*)$`, "m").exec(unit)?.[1];

describe("the pinned release", () => {
  it("names one version, and every archive by size and SHA-256", () => {
    expect(PINNED_VERSION).toBe("v0.6.2");
    for (const [version, release] of Object.entries(RELEASES)) {
      expect(release.commit, version).toMatch(/^[0-9a-f]{40}$/);
      for (const asset of Object.values(release.assets)) {
        expect(asset.sha256, asset.file).toMatch(/^[0-9a-f]{64}$/);
        expect(asset.bytes).toBeGreaterThan(1_000_000);
      }
    }
  });

  it("answers an upgrade question only from the notes it copied", () => {
    expect(upgradeModeFor("v0.6.1", "v0.6.2").mode).toBe("rolling");
    expect(upgradeModeFor("v0.5.1", "v0.6.0").mode).toBe("stop-all");
    expect(upgradeModeFor("v0.6.2", "v0.6.2").mode).toBe("rolling");
    // Skipping a release, going back, or a release newer than this chapter: not listed, so not guessed.
    expect(upgradeModeFor("v0.6.0", "v0.6.2").mode).toBe("unknown");
    expect(upgradeModeFor("v0.6.2", "v0.6.1").mode).toBe("unknown");
    expect(upgradeModeFor("v0.6.2", "v0.7.0").mode).toBe("unknown");
    expect(UPGRADE_NOTES.at(-1)).toMatchObject({ to: PINNED_VERSION });
  });
});

describe("the systemd unit", () => {
  const unit = renderUnit(spec);

  it("restarts celld whatever the exit, with no limit on attempts", () => {
    expect(setting(unit, "Restart")).toBe("always");
    expect(setting(unit, "StartLimitIntervalSec")).toBe("0");
    expect(unit).not.toContain("StartLimitBurst");
  });

  it("waits at least one lease lifetime before a restart", () => {
    expect(Number(setting(unit, "RestartSec")) * 1000).toBeGreaterThanOrEqual(
      DOCUMENTED.leaseTtlMs,
    );
  });

  it("gives SIGTERM longer than celld's own shutdown bound before SIGKILL", () => {
    expect(setting(unit, "KillSignal")).toBe("SIGTERM");
    expect(Number(setting(unit, "TimeoutStopSec")) * 1000).toBeGreaterThan(
      DOCUMENTED.shutdownTotalMs,
    );
  });

  it("does not start without the data volume, and does not run as root", () => {
    expect(setting(unit, "AssertPathIsMountPoint")).toBe("/var/lib/celld");
    expect(setting(unit, "User")).toBe("celld");
    expect(setting(unit, "ExecStart")).toBe("/opt/celld/current/celld");
  });

  it("cannot be configured to break either of celld's two supervisor rules", () => {
    expect(() => v.parse(nodeSpecSchema, { ...spec, stopTimeoutSeconds: 40 })).toThrow(
      "CELLD_SHUTDOWN_TOTAL_MS",
    );
    expect(() => v.parse(nodeSpecSchema, { ...spec, restartDelaySeconds: 9 })).toThrow(
      "lease lifetime",
    );
  });
});

describe("user data", () => {
  const userData = renderUserData(spec);

  it("prepares the machine and stops there: no celld, no bucket, no address", () => {
    expect(userData).not.toMatch(/github\.com|s3:\/\/[a-z]/);
    expect(userData).not.toContain("systemctl start");
    expect(userData).toContain("systemctl enable 'celld.service'");
    expect(Buffer.byteLength(userData)).toBeLessThan(USER_DATA_LIMIT_BYTES);
  });

  it("carries the same files that deploy/ shows", () => {
    for (const [name, content] of Object.entries(renderedFiles())) {
      expect(
        readFileSync(fileURLToPath(new URL(`../deploy/${name}`, import.meta.url)), "utf8"),
        name,
      ).toBe(content);
      if (name !== "user-data.sh") {
        expect(userData, name).toContain(content.trimEnd());
      }
    }
  });

  it("refuses a value that could break out of the script", () => {
    for (const bad of [
      { user: "celld; rm -rf /" },
      { dataMount: "/var/lib/celld'" },
      { appDir: "/opt/../etc" },
    ]) {
      expect(() => renderUserData({ ...spec, ...bad } as NodeSpec), JSON.stringify(bad)).toThrow();
    }
  });
});

// Runs the real install script with bash. `aws` is replaced by a stand-in that
// "downloads" a file we choose; everything after the checksum needs root and
// instance metadata, so those steps are read, not run.
describe("the install script", () => {
  function machine(archive: string) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "aih-celld-")));
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "aws"),
      `#!/bin/sh\nfor last; do :; done\nprintf '%s' '${archive}' > "$last"\n`,
    );
    chmodSync(join(bin, "aws"), 0o755);
    const script = renderInstallScript({
      ...spec,
      appDir: join(root, "opt"),
      envFile: join(root, "etc", "celld.env"),
    });
    const install = (...args: string[]) =>
      spawnSync("bash", ["-s", "--", ...args], {
        input: script,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` },
      });
    return { root, install };
  }
  const digest = assetOf(PINNED_VERSION, ARTIFACT_TARGET).sha256;
  const hasSha256sum = spawnSync("sha256sum", ["--version"]).status === 0;

  it.each([
    ["a bucket", ["Not_A_Bucket", "v0.6.2", digest]],
    ["a release tag", ["my-bucket", "latest", digest]],
    ["a release tag with a path", ["my-bucket", "v0.6.2/../x", digest]],
    ["a digest", ["my-bucket", "v0.6.2", "abc"]],
    ["any argument", []],
  ])("exits before touching anything when it is not given %s", (_what, args) => {
    const { root, install } = machine("anything");
    const result = install(...args);
    expect(result.status).toBe(64);
    expect(existsSync(join(root, "opt"))).toBe(false);
  });

  it.skipIf(!hasSha256sum)(
    "refuses an archive whose digest is not the pinned one, and installs nothing",
    () => {
      const { root, install } = machine("not the release");
      const result = install("my-bucket", "v0.6.2", digest);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("checksum mismatch");
      expect(existsSync(join(root, "opt", "releases", "v0.6.2", "celld"))).toBe(false);
      expect(existsSync(join(root, "opt", "releases", "v0.6.2", "celld.gz.download"))).toBe(false);
      expect(existsSync(join(root, "opt", "current"))).toBe(false);
      expect(existsSync(join(root, "etc", "celld.env"))).toBe(false);
    },
  );

  it("writes the settings celld documents, and never restarts the service", () => {
    const script = renderInstallScript(spec);
    for (const line of [
      "CELLD_BUCKET=s3://$bucket/fleet",
      "AWS_REGION=ap-northeast-1",
      "CELLD_ADDR=127.0.0.1:8080",
      "CELLD_INTERNAL_ADDR=$address:8081",
      "CELLD_ADVERTISE=$address:8081",
      "CELLD_WATCH=/var/lib/celld/state",
    ]) {
      expect(script).toContain(`\n${line}\n`);
    }
    expect(script).not.toMatch(/systemctl (re)?start/);
    // IMDSv2: the address is read with a session token.
    expect(script).toContain("X-aws-ec2-metadata-token: $token");
    // Nothing is fetched from the internet on the node.
    expect(script).not.toContain("github.com");
  });
});
