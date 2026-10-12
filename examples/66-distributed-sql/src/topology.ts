import * as v from "valibot";

import { DOCUMENTED } from "./yugabyte.ts";

export const NODE_NAMES = ["a", "b", "c"] as const;
export type NodeName = (typeof NODE_NAMES)[number];

// #region schema
const port = v.pipe(v.number(), v.integer(), v.minValue(1024), v.maxValue(65535));
const portsSchema = v.object({
  masterRpc: port,
  masterWeb: port,
  tserverRpc: port,
  tserverWeb: port,
  ysql: port,
  ysqlWeb: port,
});
// An IPv4 address, or a `${NAME}` that the node's own shell fills in when it writes the file.
const address = v.pipe(v.string(), v.regex(/^(?:(?:\d{1,3}\.){3}\d{1,3}|\$\{[A-Z_]+\})$/));
const absolutePath = v.pipe(v.string(), v.regex(/^\/[A-Za-z0-9._/-]+$/));

const nodeSchema = v.object({
  name: v.picklist(NODE_NAMES),
  address,
  zone: v.pipe(v.string(), v.regex(/^(?:[a-z0-9-]+|\$\{[A-Z_]+\})$/)),
  dataDir: absolutePath,
  ports: portsSchema,
});

export const clusterSchema = v.pipe(
  v.object({
    cloud: v.pipe(v.string(), v.regex(/^[a-z0-9]+$/)),
    region: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)),
    nodes: v.array(nodeSchema),
    /** Where `ca.crt`, `node.<address>.crt` and `node.<address>.key` are. Unset: no TLS, loopback only. */
    certsDir: v.optional(absolutePath),
    /** A cap per process, for a laptop. Unset: each process sizes itself from the machine's RAM. */
    memoryLimitBytes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(256 * 1024 * 1024))),
  }),
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) {
      return;
    }
    const { nodes, certsDir } = dataset.value;
    // One master per copy of the catalog: fewer cannot hold a majority, more is not what the docs describe.
    if (nodes.length !== DOCUMENTED.replicationFactor) {
      addIssue({
        message: `a cluster here has ${DOCUMENTED.replicationFactor} nodes, not ${nodes.length}`,
      });
    }
    if (new Set(nodes.map((node) => node.name)).size !== nodes.length) {
      addIssue({ message: "two nodes have the same name" });
    }
    const listeners = nodes.flatMap((node) =>
      Object.values(node.ports).map((value) => `${node.address}:${value}`),
    );
    if (new Set(listeners).size !== listeners.length) {
      addIssue({ message: "two listeners share an address and a port" });
    }
    if (new Set(nodes.map((node) => node.dataDir)).size !== nodes.length && sameHost(nodes)) {
      addIssue({ message: "two nodes on one host share a data directory" });
    }
    // Without TLS anyone who reaches the port is a peer. That is acceptable on loopback only.
    if (certsDir === undefined && nodes.some((node) => node.address !== "127.0.0.1")) {
      addIssue({ message: "a cluster that is not on 127.0.0.1 needs certsDir" });
    }
  }),
);
export type Cluster = v.InferOutput<typeof clusterSchema>;
export type ClusterNode = Cluster["nodes"][number];
// #endregion schema

function sameHost(nodes: { address: string }[]): boolean {
  return new Set(nodes.map((node) => node.address)).size !== nodes.length;
}

export const parseCluster = (input: unknown): Cluster => v.parse(clusterSchema, input);

export function nodeOf(cluster: Cluster, name: NodeName): ClusterNode {
  const node = cluster.nodes.find((candidate) => candidate.name === name);
  if (node === undefined) {
    throw new Error(`the cluster has no node ${name}`);
  }
  return node;
}

export const masterAddresses = (cluster: Cluster): string =>
  cluster.nodes.map((node) => `${node.address}:${node.ports.masterRpc}`).join(",");

// #region flags
function sharedFlags(cluster: Cluster, node: ClusterNode): string[] {
  return [
    `--fs_data_dirs=${node.dataDir}`,
    `--placement_cloud=${cluster.cloud}`,
    `--placement_region=${cluster.region}`,
    `--placement_zone=${node.zone}`,
    `--webserver_interface=${node.address}`,
    ...(cluster.certsDir === undefined
      ? []
      : [
          `--certs_dir=${cluster.certsDir}`,
          "--use_node_to_node_encryption=true",
          "--use_client_to_server_encryption=true",
          // Refuse a peer or a client that does not speak TLS, instead of falling back.
          "--allow_insecure_connections=false",
        ]),
    ...(cluster.memoryLimitBytes === undefined
      ? []
      : [`--memory_limit_hard_bytes=${cluster.memoryLimitBytes}`]),
  ];
}

/** The flag file of one yb-master: the catalog, and one voter of its Raft group. */
export function masterFlags(cluster: Cluster, name: NodeName): string[] {
  const node = nodeOf(cluster, name);
  return [
    `--master_addresses=${masterAddresses(cluster)}`,
    `--rpc_bind_addresses=${node.address}:${node.ports.masterRpc}`,
    `--webserver_port=${node.ports.masterWeb}`,
    `--replication_factor=${DOCUMENTED.replicationFactor}`,
    ...sharedFlags(cluster, node),
  ];
}

/** The flag file of one yb-tserver: the tablets, and the PostgreSQL-compatible listener. */
export function tserverFlags(cluster: Cluster, name: NodeName): string[] {
  const node = nodeOf(cluster, name);
  return [
    `--tserver_master_addrs=${masterAddresses(cluster)}`,
    `--rpc_bind_addresses=${node.address}:${node.ports.tserverRpc}`,
    `--webserver_port=${node.ports.tserverWeb}`,
    "--enable_ysql=true",
    `--pgsql_proxy_bind_address=${node.address}:${node.ports.ysql}`,
    `--pgsql_proxy_webserver_port=${node.ports.ysqlWeb}`,
    // The chapter uses the SQL API only.
    "--start_cql_proxy=false",
    "--start_redis_proxy=false",
    ...(cluster.certsDir === undefined ? [] : ["--ysql_enable_auth=true"]),
    ...sharedFlags(cluster, node),
  ];
}
// #endregion flags

// #region local
/**
 * Three nodes on one laptop. macOS has only 127.0.0.1 on its loopback
 * interface, so the nodes differ by port and not, as in the documentation's
 * examples, by address. One "zone" each, so placement behaves as on EC2.
 */
export function localCluster(baseDir: string, certsDir?: string): Cluster {
  return parseCluster({
    cloud: "local",
    region: "laptop",
    certsDir,
    memoryLimitBytes: 1024 * 1024 * 1024,
    nodes: NODE_NAMES.map((name, index) => ({
      name,
      address: "127.0.0.1",
      zone: `zone-${name}`,
      dataDir: `${baseDir}/node-${name}`,
      ports: {
        masterRpc: 27101 + index,
        masterWeb: 27001 + index,
        tserverRpc: 29101 + index,
        tserverWeb: 29001 + index,
        ysql: 25431 + index,
        ysqlWeb: 23001 + index,
      },
    })),
  });
}
// #endregion local

// #region ec2
/**
 * Three nodes on three instances, on the documented ports. The addresses are
 * not known until the instances exist, so each is a shell variable that the
 * node's configure script fills in.
 */
export function ec2Cluster(input: { region: string; dataDir: string; certsDir: string }): Cluster {
  return parseCluster({
    cloud: "aws",
    region: input.region,
    certsDir: input.certsDir,
    nodes: NODE_NAMES.map((name) => ({
      name,
      address: `\${ADDR_${name.toUpperCase()}}`,
      // Only a node's own zone appears in its files.
      zone: "${ZONE}",
      dataDir: input.dataDir,
      ports: { ...DOCUMENTED.ports },
    })),
  });
}
// #endregion ec2
