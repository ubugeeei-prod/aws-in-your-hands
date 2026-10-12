import { describe, expect, it } from "vite-plus/test";

import {
  ec2Cluster,
  localCluster,
  masterFlags,
  parseCluster,
  tserverFlags,
} from "../src/topology.ts";
import { DOCUMENTED, RELEASE } from "../src/yugabyte.ts";

const local = localCluster("/tmp/run");
const ec2 = ec2Cluster({
  region: "ap-northeast-1",
  dataDir: "/var/lib/yugabyte/data",
  certsDir: "/etc/yugabyte/certs",
});
const flag = (lines: string[], name: string): string | undefined =>
  lines.find((line) => line.startsWith(`--${name}=`))?.slice(name.length + 3);

describe("the pinned release", () => {
  it("names one version, and each archive by size and SHA-256", () => {
    expect(RELEASE.version).toBe("2025.2.7.0");
    for (const asset of Object.values(RELEASE.assets)) {
      expect(asset.file).toContain(`${RELEASE.version}-${RELEASE.build}`);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.bytes).toBeGreaterThan(100_000_000);
    }
  });
});

describe("a cluster definition", () => {
  it("is three nodes, because the catalog and every tablet have three copies", () => {
    const two = { ...local, nodes: local.nodes.slice(0, 2) };
    expect(() => parseCluster(two)).toThrow(/3 nodes, not 2/);
  });

  it("refuses two listeners on one address and port", () => {
    const [a, b, c] = local.nodes;
    const clash = { ...local, nodes: [a, { ...b, ports: a?.ports }, c] };
    expect(() => parseCluster(clash)).toThrow(/share an address and a port/);
  });

  it("refuses a cluster off loopback without TLS", () => {
    const exposed = {
      ...local,
      nodes: local.nodes.map((node, index) => ({ ...node, address: `10.0.0.${index + 1}` })),
    };
    expect(() => parseCluster(exposed)).toThrow(/needs certsDir/);
    expect(() => parseCluster({ ...exposed, certsDir: "/etc/certs" })).not.toThrow();
  });

  it("lets nothing but an address or a shell variable into a flag file", () => {
    const [a, b, c] = local.nodes;
    for (const address of ["127.0.0.1 --evil", "$(reboot)", "${addr}", "host;rm"]) {
      expect(() => parseCluster({ ...local, nodes: [{ ...a, address }, b, c] }), address).toThrow();
    }
  });
});

describe("the flag files", () => {
  it("give every master the same list of all three masters", () => {
    const lists = (["a", "b", "c"] as const).map((name) =>
      flag(masterFlags(local, name), "master_addresses"),
    );
    expect(new Set(lists)).toEqual(new Set(["127.0.0.1:27101,127.0.0.1:27102,127.0.0.1:27103"]));
    expect(flag(tserverFlags(local, "b"), "tserver_master_addrs")).toBe(lists[0]);
  });

  it("put each node in its own zone, so no two copies of a tablet share one", () => {
    const zones = (["a", "b", "c"] as const).map((name) =>
      flag(tserverFlags(local, name), "placement_zone"),
    );
    expect(new Set(zones).size).toBe(3);
    expect(flag(masterFlags(local, "a"), "replication_factor")).toBe("3");
  });

  it("bind every listener to the node's own address, never to all interfaces", () => {
    for (const name of ["a", "b", "c"] as const) {
      const all = [...masterFlags(ec2, name), ...tserverFlags(ec2, name)].join("\n");
      expect(all).not.toContain("0.0.0.0");
      expect(flag(tserverFlags(ec2, name), "webserver_interface")).toBe(
        `\${ADDR_${name.toUpperCase()}}`,
      );
    }
  });

  it("on EC2 use the documented ports and refuse peers and clients without TLS", () => {
    const master = masterFlags(ec2, "a");
    const tserver = tserverFlags(ec2, "a");
    expect(flag(master, "rpc_bind_addresses")).toBe(`\${ADDR_A}:${DOCUMENTED.ports.masterRpc}`);
    expect(flag(tserver, "pgsql_proxy_bind_address")).toBe(`\${ADDR_A}:${DOCUMENTED.ports.ysql}`);
    for (const lines of [master, tserver]) {
      expect(flag(lines, "use_node_to_node_encryption")).toBe("true");
      expect(flag(lines, "use_client_to_server_encryption")).toBe("true");
      expect(flag(lines, "allow_insecure_connections")).toBe("false");
      expect(flag(lines, "certs_dir")).toBe("/etc/yugabyte/certs");
    }
    // With TLS on, a password is asked for as well.
    expect(flag(tserver, "ysql_enable_auth")).toBe("true");
  });

  it("without certificates turn nothing on that needs them", () => {
    const all = [...masterFlags(local, "a"), ...tserverFlags(local, "a")].join("\n");
    expect(all).not.toMatch(/encryption|certs_dir|ysql_enable_auth/);
  });
});
