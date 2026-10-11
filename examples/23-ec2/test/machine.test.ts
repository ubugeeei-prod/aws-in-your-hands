import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { parseEc2Config } from "../src/config.ts";
import { machineFor, type MachineSpec, pathsOf } from "../src/machine.ts";
import { renderedFiles } from "../src/rendered.ts";
import { renderEnvFile, renderUnit } from "../src/unit.ts";
import {
  renderDataVolumeScript,
  renderReleaseScript,
  renderUserData,
  USER_DATA_LIMIT_BYTES,
} from "../src/user-data.ts";

const machine = machineFor(parseEc2Config({}));
const deployed = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../deploy/${name}`, import.meta.url)), "utf8");

// Things that must never reach a root shell as written.
const HOSTILE = [
  "x; rm -rf /",
  "$(id)",
  "`id`",
  "a b",
  "it's",
  'say "hi"',
  "line\nbreak",
  "back\\slash",
  "a|b",
  "a&b",
  "a>b",
  "",
];

describe("the files under deploy/", () => {
  it.each(Object.keys(renderedFiles()))("%s is what the generators produce today", (name) => {
    // If this fails, run `vp run ec2:render --write` and read the diff.
    expect(deployed(name)).toBe(renderedFiles()[name]);
  });

  it.each(["user-data.sh", "notes-data-volume.sh", "notes-release.sh"])("%s parses as bash", (name) => {
    const result = spawnSync("bash", ["-n"], { input: deployed(name), encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("user data", () => {
  const script = renderUserData(machine);

  it("fits in the 16 KB that EC2 accepts, with room to grow", () => {
    expect(script.startsWith("#!/bin/bash\n")).toBe(true);
    expect(Buffer.byteLength(script)).toBeLessThan(USER_DATA_LIMIT_BYTES / 2);
  });

  it("stops at the first failing command instead of carrying on half-configured", () => {
    expect(script.split("\n")[2]).toBe("set -euo pipefail");
  });

  it("carries the four files byte for byte, inside quoted here-documents", () => {
    const paths = pathsOf(machine);
    const embedded: [string, string][] = [
      [machine.envFile, renderEnvFile(machine)],
      [paths.unit, renderUnit(machine)],
      [paths.volumeScript, renderDataVolumeScript(machine)],
      [paths.releaseScript, renderReleaseScript(machine)],
    ];
    for (const [path, content] of embedded) {
      // The quotes around the delimiter are what keep $DEVICE and $(...) from being expanded at boot.
      expect(script).toContain(`cat > '${path}' <<'AIH_EOF'\n${content}AIH_EOF\n`);
    }
    expect(script.match(/^AIH_EOF$/gm)).toHaveLength(embedded.length);
  });

  it("contains no credential and nothing that looks like one", () => {
    // Anyone who can call DescribeInstanceAttribute, and any process on the instance, can read user data.
    expect(script).not.toMatch(/AKIA|ASIA|aws_secret|secret_access|password|passwd|BEGIN [A-Z ]*PRIVATE KEY|token=/i);
    expect(
      renderEnvFile(machine)
        .trim()
        .split("\n")
        .map((line) => line.split("=")[0]),
    ).toEqual(["ALLOWED_ORIGIN", "LOG_LEVEL", "STAGE", "HOST", "PORT", "NOTES_FILE"]);
  });

  it.each(Object.keys(machine).filter((key) => typeof machine[key as keyof MachineSpec] === "string"))(
    "refuses to render when %s could break out of its quotes",
    (key) => {
      for (const value of HOSTILE) {
        const spec = { ...machine, [key]: value };
        expect(() => renderUserData(spec), JSON.stringify(value)).toThrow();
        expect(() => renderUnit(spec), JSON.stringify(value)).toThrow();
        expect(() => renderEnvFile(spec), JSON.stringify(value)).toThrow();
      }
    },
  );

  it("refuses a path that climbs out of its directory", () => {
    expect(() => renderUserData({ ...machine, appDir: "/opt/../etc" })).toThrow();
  });

  it("rejects an origin that would add a line to the environment file", () => {
    for (const origin of [
      "http://a\nLOG_LEVEL=debug",
      "http://a b",
      "http://a'",
      "javascript:alert(1)",
      "http://a/$(id)",
    ]) {
      expect(() => parseEc2Config({ allowedOrigin: origin }), JSON.stringify(origin)).toThrow("Invalid EC2 settings");
    }
    expect(parseEc2Config({ allowedOrigin: "https://d111.cloudfront.net" }).allowedOrigin).toBe(
      "https://d111.cloudfront.net",
    );
  });
});

describe("the systemd unit", () => {
  const unit = renderUnit(machine);
  const value = (key: string): string[] =>
    unit
      .split("\n")
      .filter((line) => line.startsWith(`${key}=`))
      .map((line) => line.slice(key.length + 1));

  it("runs as an unprivileged user that can write to the data volume and nowhere else", () => {
    expect(value("User")).toEqual(["notes"]);
    expect(value("NoNewPrivileges")).toEqual(["true"]);
    expect(value("ProtectSystem")).toEqual(["strict"]);
    expect(value("ReadWritePaths")).toEqual([machine.dataMount]);
  });

  it("will not start unless the data volume is mounted", () => {
    // Otherwise the notes would be written to the root volume and deleted with the instance.
    expect(value("RequiresMountsFor")).toEqual([machine.dataMount]);
    expect(value("AssertPathIsMountPoint")).toEqual([machine.dataMount]);
    expect(renderEnvFile(machine)).toContain(`NOTES_FILE=${machine.dataMount}/`);
  });

  it("restarts after a crash, but not forever", () => {
    expect(value("Restart")).toEqual(["on-failure"]);
    expect(value("StartLimitBurst")).toEqual(["5"]);
  });

  it("listens on loopback, so the security group is not the only thing between it and the network", () => {
    expect(renderEnvFile(machine)).toContain("HOST=127.0.0.1\n");
  });

  it("pins the Node.js major version instead of following the alternatives link", () => {
    expect(value("ExecStart")).toEqual(["/usr/bin/node-24 /opt/notes/current/server.mjs"]);
    expect(renderUserData(machine)).toContain("dnf install -y 'nodejs24' xfsprogs");
  });
});
