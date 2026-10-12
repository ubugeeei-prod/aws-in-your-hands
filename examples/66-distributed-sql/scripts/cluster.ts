// vp run distsql:local:start | distsql:local:stop | distsql:local:status | distsql:local:destroy
//   node scripts/cluster.ts start [a|b|c]     start every node, or one (--tls on a new cluster)
//   node scripts/cluster.ts stop [a|b|c]      SIGTERM
//   node scripts/cluster.ts kill <a|b|c>      SIGKILL, as a crash
//   node scripts/cluster.ts status
//   node scripts/cluster.ts destroy           stop everything and delete .yugabyte/run
//
// Runs the binaries that `vp run distsql:fetch` unpacked, on 127.0.0.1 only.
// Touches no AWS account and no network beyond loopback.

import { rmSync } from "node:fs";

import * as v from "valibot";

import { NODE_NAMES, type NodeName, nodeOf } from "../src/topology.ts";
import {
  binariesPresent,
  currentCluster,
  enableTls,
  crash,
  pidOf,
  PROCESSES,
  runDir,
  signal,
  startProcess,
} from "./local-nodes.ts";

const words = process.argv.slice(2).filter((word) => !word.startsWith("--"));
const [command, nodeText] = words;
const only = v.parse(v.optional(v.picklist(NODE_NAMES)), nodeText);
const targets: readonly NodeName[] = only === undefined ? NODE_NAMES : [only];

if (!binariesPresent()) {
  console.error("The binaries are not here. Run `vp run distsql:fetch` first.");
  process.exit(1);
}

switch (command) {
  case "start":
    if (process.argv.includes("--tls")) {
      enableTls();
    }
    // Masters first: a tablet server registers with them.
    for (const name of PROCESSES) {
      for (const node of targets) {
        startProcess(node, name);
      }
    }
    break;
  case "stop":
    for (const node of targets) {
      signal(node, "tserver", "SIGTERM");
      signal(node, "master", "SIGTERM");
    }
    break;
  case "kill":
    if (only === undefined) {
      console.error("kill takes one node: a, b, or c");
      process.exit(64);
    }
    crash(only);
    break;
  case "status":
    for (const node of NODE_NAMES) {
      const ports = nodeOf(currentCluster(), node).ports;
      console.log(
        `node ${node}: master ${pidOf(node, "master") ?? "down"} (rpc ${ports.masterRpc}), tserver ${pidOf(node, "tserver") ?? "down"} (ysql ${ports.ysql})`,
      );
    }
    break;
  case "destroy":
    for (const node of NODE_NAMES) {
      crash(node);
    }
    rmSync(runDir, { recursive: true, force: true });
    console.log(`${runDir} removed`);
    break;
  default:
    console.error("usage: cluster.ts start|stop|status|destroy [node]  |  cluster.ts kill <node>");
    process.exit(64);
}
