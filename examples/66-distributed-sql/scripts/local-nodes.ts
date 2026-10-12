// The three local nodes as processes: start, signal, and ask whether they run.
// Used by cluster.ts and verify.ts. Loopback only.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type Cluster,
  localCluster,
  masterFlags,
  type NodeName,
  nodeOf,
  tserverFlags,
} from "../src/topology.ts";
import { UNPACKED_DIRECTORY } from "../src/yugabyte.ts";

export const home = resolve(`.yugabyte/dist/${UNPACKED_DIRECTORY}`);
export const runDir = resolve(".yugabyte/run");
export const certsDir = resolve(".yugabyte/certs");
// Written by `start --tls` into an empty run directory: a cluster is with TLS or without for its whole life.
const tlsMarker = `${runDir}/tls`;
export const tls = (): boolean => existsSync(tlsMarker);
export function enableTls(): void {
  if (existsSync(runDir)) {
    throw new Error("TLS is chosen when the cluster is created. Run `destroy` first.");
  }
  if (!existsSync(`${certsDir}/ca.crt`)) {
    throw new Error("No certificates. Run `vp run distsql:local:certs` first.");
  }
  mkdirSync(runDir, { recursive: true });
  writeFileSync(tlsMarker, "");
}
export const currentCluster = (): Cluster => localCluster(runDir, tls() ? certsDir : undefined);
export const PROCESSES = ["master", "tserver"] as const;
export type Process = (typeof PROCESSES)[number];

export const binariesPresent = (): boolean => existsSync(`${home}/bin/yb-master`);

const pidFile = (node: NodeName, name: Process): string => `${runDir}/node-${node}/${name}.pid`;

export function pidOf(node: NodeName, name: Process): number | undefined {
  if (!existsSync(pidFile(node, name))) {
    return undefined;
  }
  const pid = Number(readFileSync(pidFile(node, name), "utf8"));
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return undefined;
  }
}

// #region start
export function startProcess(node: NodeName, name: Process): void {
  if (pidOf(node, name) !== undefined) {
    return;
  }
  const directory = nodeOf(currentCluster(), node).dataDir;
  mkdirSync(directory, { recursive: true });
  const flagFile = `${directory}/${name}.conf`;
  const flags =
    name === "master" ? masterFlags(currentCluster(), node) : tserverFlags(currentCluster(), node);
  writeFileSync(flagFile, `${flags.join("\n")}\n`);
  const log = openSync(`${directory}/${name}.out`, "a");
  // Detached: the node outlives this script, as a service outlives the shell that started it.
  const child = spawn(`${home}/bin/yb-${name}`, ["--flagfile", flagFile], {
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  writeFileSync(pidFile(node, name), String(child.pid));
  console.log(`node ${node}: yb-${name} started, pid ${child.pid}`);
}
// #endregion start

export function signal(node: NodeName, name: Process, how: "SIGTERM" | "SIGKILL"): void {
  const pid = pidOf(node, name);
  if (pid === undefined) {
    return;
  }
  process.kill(pid, how);
  unlinkSync(pidFile(node, name));
  console.log(`node ${node}: yb-${name} (pid ${pid}) got ${how}`);
}

/** Both processes of a node at once, with no chance to say goodbye: what a lost instance looks like. */
export function crash(node: NodeName): void {
  signal(node, "tserver", "SIGKILL");
  signal(node, "master", "SIGKILL");
}

export function start(node: NodeName): void {
  startProcess(node, "master");
  startProcess(node, "tserver");
}
