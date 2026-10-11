import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";
import { parseEc2Config } from "../src/config.ts";
import { machineFor } from "../src/machine.ts";
import { releaseKey, releaseVersion, VERSION_SHELL_PATTERN, versionSchema } from "../src/release.ts";
import {
  forwardArgs,
  invocationSchema,
  isFinished,
  remoteCommands,
  sendCommandArgs,
  succeeded,
  uploadArgs,
} from "../src/remote.ts";
import { renderReleaseScript } from "../src/user-data.ts";

const machine = machineFor(parseEc2Config({}));
const commands = remoteCommands(machine);
const VERSION = "20261012T010203Z-0123456789abcdef";
const BUCKET = "aihec2-releases-abc123";
const INSTANCE = "i-0123456789abcdef0";

const HOSTILE = ["v1; reboot", "$(reboot)", "`reboot`", "../../etc", "a b", "x'y", "x\ny", "", "latest"];

describe("release versions", () => {
  it("names a release by build time and content", () => {
    const bundle = new TextEncoder().encode("console.log(1)");
    const version = releaseVersion(bundle, new Date("2026-10-12T01:02:03.456Z"));

    expect(version).toMatch(/^20261012T010203Z-[0-9a-f]{16}$/);
    expect(releaseVersion(bundle, new Date("2026-10-12T01:02:03.999Z"))).toBe(version);
    expect(releaseVersion(new TextEncoder().encode("console.log(2)"), new Date("2026-10-12T01:02:03Z"))).not.toBe(
      version,
    );
    expect(releaseKey(version)).toBe(`releases/${version}/server.mjs`);
  });

  it("is checked on the instance with the same pattern as on your machine", () => {
    expect(versionSchema.safeParse(VERSION).success).toBe(true);
    expect(renderReleaseScript(machine)).toContain(`[[ ! "$version" =~ ${VERSION_SHELL_PATTERN} ]]`);
  });
});

describe("what is sent to the instance", () => {
  it("builds the release command from a validated bucket and version only", () => {
    expect(commands.release(BUCKET, VERSION)).toEqual([`/usr/local/sbin/notes-release ${BUCKET} ${VERSION}`]);
    for (const value of HOSTILE) {
      expect(() => commands.release(BUCKET, value), JSON.stringify(value)).toThrow();
      expect(() => releaseKey(value), JSON.stringify(value)).toThrow();
    }
    for (const value of ["b; reboot", "$(reboot)", "a/../b", "A-Bucket", "a b", "x'y", ""]) {
      expect(() => commands.release(value, VERSION), JSON.stringify(value)).toThrow();
    }
  });

  it("upgrades to a named Amazon Linux release, never to whatever is latest", () => {
    expect(commands.patchApply("2023.12.20260930")).toContain("dnf upgrade -y --releasever=2023.12.20260930");
    for (const value of [...HOSTILE, "2023.12.20260930 --nogpgcheck", "2024.1.20260101"]) {
      expect(() => commands.patchApply(value), JSON.stringify(value)).toThrow();
    }
  });

  it("hands the command lines to the AWS CLI as one JSON argument, with no local shell in between", () => {
    const lines = commands.smoke();
    const args = sendCommandArgs({ instanceId: INSTANCE, region: "ap-northeast-1", commands: lines, comment: "test" });

    expect(args.slice(0, 6)).toEqual([
      "ssm",
      "send-command",
      "--instance-ids",
      INSTANCE,
      "--document-name",
      "AWS-RunShellScript",
    ]);
    expect(JSON.parse(args[args.indexOf("--parameters") + 1] ?? "")).toEqual({ commands: lines });
    expect(() => sendCommandArgs({ instanceId: "i-123; id", region: "r", commands: [], comment: "" })).toThrow();
  });

  it("forwards the API port over a session instead of opening it in the security group", () => {
    const args = forwardArgs({ instanceId: INSTANCE, region: "ap-northeast-1", port: machine.port });
    expect(args).toContain("AWS-StartPortForwardingSession");
    expect(JSON.parse(args.at(-1) ?? "")).toEqual({ portNumber: ["8787"], localPortNumber: ["8787"] });
  });

  it("uploads under the prefix the instance role may read", () => {
    const args = uploadArgs({ file: "dist/server.mjs", bucket: BUCKET, key: releaseKey(VERSION), region: "r" });
    expect(args[3]).toBe(`s3://${BUCKET}/releases/${VERSION}/server.mjs`);
  });

  it("mounts a restored volume with the script that refuses to format one", () => {
    expect(commands.mount()).toEqual([
      "set -euo pipefail",
      "/usr/local/sbin/notes-data-volume",
      "systemctl start notes.service",
    ]);
  });

  it("unmounts only after the service has stopped writing", () => {
    expect(commands.unmount()).toEqual([
      "set -euo pipefail",
      "systemctl stop notes.service",
      "sync",
      "umount /var/lib/notes",
    ]);
  });
});

describe("reading the result of a command", () => {
  const parse = (value: unknown) => invocationSchema.parse(value);

  it("waits while the command runs and treats only exit code 0 as success", () => {
    expect(isFinished(parse({ Status: "InProgress" }))).toBe(false);
    expect(isFinished(parse({ Status: "Pending", ResponseCode: -1 }))).toBe(false);
    expect(succeeded(parse({ Status: "Success", ResponseCode: 0, StandardOutputContent: "ok" }))).toBe(true);
    for (const result of [
      { Status: "Failed", ResponseCode: 1 },
      { Status: "TimedOut" },
      { Status: "Cancelled" },
      { Status: "Success", ResponseCode: 3 },
    ]) {
      expect(isFinished(parse(result))).toBe(true);
      expect(succeeded(parse(result))).toBe(false);
    }
  });
});

describe("the release script, run with bad arguments", () => {
  // It exits before touching anything, so it is safe to run here as it is.
  const run = (...args: string[]) =>
    spawnSync("bash", ["-s", "--", ...args], { input: renderReleaseScript(machine), encoding: "utf8" });

  it.each([
    ["no arguments", []],
    ["a bucket with a path in it", ["bucket/../other", VERSION]],
    ["an uppercase bucket", ["Bucket", VERSION]],
    ["a version with a command in it", [BUCKET, "20261012T010203Z-0123456789abcdef; reboot"]],
    ["a version with a path in it", [BUCKET, "../../../etc/passwd"]],
    ["a short hash", [BUCKET, "20261012T010203Z-0123"]],
  ])("exits 64 for %s", (_, args) => {
    const result = run(...args);
    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
  });
});
