import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { USER_DATA_LIMIT_BYTES } from "@aih/example-23-ec2/src/user-data.ts";

import { certFiles, extensionsFor, NODE_DAYS, requestArgs, signArgs } from "../src/certs.ts";
import {
  artifactKey,
  NODE,
  renderConfigureScript,
  renderedFiles,
  renderInstallScript,
  renderUnit,
  renderUserData,
} from "../src/machine.ts";
import { fullyReplicated, nodeCommands } from "../src/remote.ts";
import { RELEASE } from "../src/yugabyte.ts";

const setting = (unit: string, key: string): string | undefined =>
  new RegExp(`^${key}=(.*)$`, "m").exec(unit)?.[1];

describe("the files a node gets", () => {
  it("are the ones in deploy/, byte for byte", () => {
    for (const [name, content] of Object.entries(renderedFiles())) {
      const committed = readFileSync(
        fileURLToPath(new URL(`../deploy/${name}`, import.meta.url)),
        "utf8",
      );
      expect(committed, `deploy/${name}: run vp run distsql:render --write`).toBe(content);
    }
  });

  it("fit in user data", () => {
    expect(Buffer.byteLength(renderUserData())).toBeLessThan(USER_DATA_LIMIT_BYTES);
  });

  it("start nothing on the first boot: the database is installed and configured later", () => {
    const userData = renderUserData();
    expect(userData).not.toMatch(/systemctl (start|restart)/);
    // No bucket name either: the install script takes it as an argument.
    expect(userData).not.toMatch(/s3:\/\/[a-z0-9]/);
  });
});

describe("the two services", () => {
  it("do not start without the data volume, the binaries, and the flag file", () => {
    for (const process of ["master", "tserver"] as const) {
      const unit = renderUnit(process);
      expect(setting(unit, "RequiresMountsFor")).toBe(NODE.mount);
      expect(setting(unit, "AssertPathIsMountPoint")).toBe(NODE.mount);
      expect(unit).toContain(`ConditionPathExists=${NODE.current}/bin/yb-${process}`);
      expect(unit).toContain(`ConditionPathExists=${NODE.confDir}/${process}.conf`);
    }
  });

  it("run as their own user, come back after a crash, and get the documented limits", () => {
    const unit = renderUnit("tserver");
    expect(setting(unit, "User")).toBe("yugabyte");
    expect(setting(unit, "Restart")).toBe("always");
    expect(setting(unit, "LimitNOFILE")).toBe("1048576");
    expect(setting(unit, "LimitNPROC")).toBe("12000");
  });
});

describe("installing the database", () => {
  const script = renderInstallScript();

  it("takes the archive from the artifacts prefix and trusts only the pinned digest", () => {
    expect(artifactKey()).toBe(
      `artifacts/${RELEASE.version}/${RELEASE.assets["el8-aarch64"].file}`,
    );
    expect(script).toContain(
      "s3://$bucket/artifacts/$version/yugabyte-$version-$build-el8-aarch64.tar.gz",
    );
    expect(script).toContain('if [ "$actual" != "$digest" ]; then');
    // The check comes before anything is unpacked.
    expect(script.indexOf("sha256sum")).toBeLessThan(script.indexOf("tar -xzf"));
  });

  it("accepts a bucket name, a release, and a digest from outside, each by its shape", () => {
    expect(script).toContain('if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]');
    expect(script).toContain('if [[ ! "$digest" =~ ^[0-9a-f]{64}$ ]]');
    expect(() => nodeCommands.install("bucket; reboot")).toThrow();
    expect(nodeCommands.install("aih-distsql-bucket")).toEqual([
      `/usr/local/sbin/yb-install aih-distsql-bucket ${RELEASE.version} ${RELEASE.build} ${RELEASE.assets["el8-aarch64"].sha256}`,
    ]);
  });

  it("is not part of what a new release changes: user data names no version", () => {
    expect(renderUserData()).not.toContain(RELEASE.version);
    expect(renderUserData()).not.toContain(RELEASE.assets["el8-aarch64"].sha256);
  });

  it("refuses a malformed argument before it touches anything (run with bash)", () => {
    const file = fileURLToPath(new URL("../deploy/yb-install.sh", import.meta.url));
    const digest = RELEASE.assets["el8-aarch64"].sha256;
    for (const args of [
      ["bucket; reboot", RELEASE.version, RELEASE.build, digest],
      ["aih-bucket", "latest", RELEASE.build, digest],
      ["aih-bucket", RELEASE.version, "b107; reboot", digest],
      ["aih-bucket", RELEASE.version, RELEASE.build, "abc"],
      ["aih-bucket"],
    ]) {
      const result = spawnSync("bash", [file, ...args], { encoding: "utf8" });
      expect(result.status, args.join(" ")).toBe(64);
    }
  });

  it("does not restart a running database", () => {
    expect(script).not.toContain("systemctl");
  });
});

describe("configuring a node", () => {
  const script = renderConfigureScript();

  it("accepts three IPv4 addresses and a node name, and nothing else", () => {
    expect(script).toContain('*) echo "not a node name: $NODE" >&2; exit 64 ;;');
    const addresses = { a: "10.0.2.10", b: "10.0.3.10", c: "10.0.4.10" };
    expect(nodeCommands.configure("b", addresses)).toEqual([
      "/usr/local/sbin/yb-configure b 10.0.2.10 10.0.3.10 10.0.4.10",
    ]);
    expect(() => nodeCommands.configure("b", { ...addresses, c: "10.0.4.10; reboot" })).toThrow();
  });

  it("writes each node's own address into its own files", () => {
    const forB = script.slice(script.indexOf("  b)"), script.indexOf("  c)"));
    expect(forB).toContain("--rpc_bind_addresses=${ADDR_B}:7100");
    expect(forB).toContain("--pgsql_proxy_bind_address=${ADDR_B}:5433");
    expect(forB).not.toContain("--rpc_bind_addresses=${ADDR_A}");
  });
});

describe("certificates", () => {
  it("are named the way the database looks them up", () => {
    expect(certFiles("10.0.2.10")).toEqual({
      ca: "ca.crt",
      certificate: "node.10.0.2.10.crt",
      key: "node.10.0.2.10.key",
    });
  });

  it("carry the node's address as the common name and as a subject alternative name", () => {
    expect(requestArgs("/tmp/c", "10.0.2.10")).toContain("/O=AWS in Your Hands/CN=10.0.2.10");
    expect(extensionsFor("10.0.2.10")).toContain("subjectAltName=IP:10.0.2.10");
    expect(extensionsFor("10.0.2.10")).toContain("CA:false");
    expect(() => extensionsFor("10.0.2.10\nbasicConstraints=CA:true")).toThrow();
  });

  it("are signed for about a year, not for the ten years of the documentation's example", () => {
    const args = signArgs({ caDirectory: "/ca", request: "r", extensions: "e", out: "o" });
    expect(args[args.indexOf("-days") + 1]).toBe(String(NODE_DAYS));
    expect(NODE_DAYS).toBeLessThanOrEqual(397);
  });

  it("never send a private key anywhere: the node prints its request, and receives public files", () => {
    const files = renderedFiles();
    expect(files["yb-csr.sh"]).toContain("cat '/etc/yugabyte/certs/node.csr'");
    expect(files["yb-csr.sh"]).not.toMatch(/cat .*\.key/);
    expect(files["yb-certificate.sh"]).toContain("does not belong to this node");
    expect(() => nodeCommands.certificate("AAAA", "not base64!")).toThrow();
  });
});

describe("before the next node is stopped", () => {
  it("nothing may be dead and no tablet short of a copy", () => {
    expect(fullyReplicated({ dead_nodes: [], under_replicated_tablets: [] })).toBe(true);
    expect(fullyReplicated({ dead_nodes: ["x"], under_replicated_tablets: [] })).toBe(false);
    expect(fullyReplicated({ dead_nodes: [], under_replicated_tablets: ["t1"] })).toBe(false);
  });

  it("stopping is one node's tablet server and then its master", () => {
    expect(nodeCommands.stop("tserver")[1]).toBe("systemctl stop yb-tserver.service");
  });
});
