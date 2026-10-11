import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parseEc2Config } from "../src/config.ts";
import { machineFor } from "../src/machine.ts";
import { renderDataVolumeScript } from "../src/user-data.ts";

const UUID = "0a1b2c3d-1111-2222-3333-444455556666";

/**
 * Runs the real script with bash. Only the commands that would touch a disk
 * are replaced: each stand-in appends its arguments to a log, and `blkid`
 * answers from a file that says whether the "volume" holds a file system.
 */
function machineWithVolume(volume: "empty" | "formatted" | "unreadable" | "detached") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aih-ec2-")));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "calls.log");
  const state = join(root, "blkid-exit");
  const device = join(root, "sdf");
  writeFileSync(log, "");
  writeFileSync(state, { empty: "2", formatted: "0", unreadable: "4", detached: "2" }[volume]);
  if (volume !== "detached") {
    writeFileSync(device, "");
  }
  const stub = (name: string, body: string): void => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub("blkid", `if [ "$1" = "-o" ]; then echo "${UUID}"; exit 0; fi\nexit "$(cat "${state}")"`);
  stub("mkfs.xfs", `echo 0 > "${state}"`);
  stub("mountpoint", `[ -e "$AIH_MOUNTED" ]`);
  stub("mount", `touch "$AIH_MOUNTED"`);
  stub("chown", "exit 0");
  stub("sleep", "exit 0");

  const boot = (fstabName: string) => {
    const fstab = join(root, fstabName);
    if (!existsSync(fstab)) {
      writeFileSync(fstab, "UUID=root-volume / xfs defaults 1 1\n");
    }
    const script = renderDataVolumeScript({
      ...machineFor(parseEc2Config({})),
      dataDevice: device,
      dataMount: join(root, "mnt"),
      fstab,
    });
    const result = spawnSync("bash", ["-s"], {
      input: script,
      encoding: "utf8",
      // One "mounted" marker per fstab: a new instance starts with nothing mounted.
      env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}`, AIH_MOUNTED: `${fstab}.mounted` },
    });
    return { status: result.status, stderr: result.stderr, fstab: readFileSync(fstab, "utf8") };
  };
  const calls = (): string[] => readFileSync(log, "utf8").trim().split("\n");
  const formats = (): number => calls().filter((call) => call.startsWith("mkfs.xfs")).length;
  return { boot, calls, formats, device, mount: join(root, "mnt") };
}

describe("the data volume script", () => {
  it("formats a new, empty volume once and mounts it by UUID", () => {
    const m = machineWithVolume("empty");
    const first = m.boot("fstab");

    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(m.formats()).toBe(1);
    expect(first.fstab).toContain(`UUID=${UUID} ${m.mount} xfs defaults,nofail 0 2\n`);
    expect(m.calls()).toContain(`mount ${m.mount}`);
  });

  it("never formats a volume that already holds a file system", () => {
    // A volume restored from a snapshot, or one that outlived its instance.
    const m = machineWithVolume("formatted");
    expect(m.boot("fstab").status).toBe(0);
    expect(m.formats()).toBe(0);
  });

  it("keeps the data when the instance is replaced and the volume is attached to the new one", () => {
    const m = machineWithVolume("empty");
    // First instance: formats.
    expect(m.boot("fstab-of-instance-1").status).toBe(0);
    // Second instance: a fresh root volume, hence a fresh fstab, and the same data volume.
    const second = m.boot("fstab-of-instance-2");

    expect(second.status).toBe(0);
    expect(m.formats()).toBe(1);
    expect(second.fstab).toContain(`UUID=${UUID} `);
  });

  it("can run twice on the same instance without a second fstab line or a second mount", () => {
    const m = machineWithVolume("empty");
    m.boot("fstab");
    const again = m.boot("fstab");

    expect(again.status).toBe(0);
    expect(again.fstab.match(new RegExp(`^UUID=${UUID} `, "gm"))).toHaveLength(1);
    expect(m.calls().filter((call) => call.startsWith("mount "))).toHaveLength(1);
  });

  it("refuses to format when it cannot tell whether the volume is empty", () => {
    const m = machineWithVolume("unreadable");
    const result = m.boot("fstab");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing to format");
    expect(m.formats()).toBe(0);
    expect(result.fstab).not.toContain(UUID);
  });

  it("fails, loudly, when the volume never shows up", () => {
    const m = machineWithVolume("detached");
    const result = m.boot("fstab");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("did not appear");
    expect(m.calls().filter((call) => call.startsWith("sleep"))).toHaveLength(60);
    expect(m.formats()).toBe(0);
  });
});
