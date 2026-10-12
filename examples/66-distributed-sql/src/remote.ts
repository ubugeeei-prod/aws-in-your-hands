import * as v from "valibot";

import { bucketNameSchema } from "@aih/example-23-ec2/src/remote.ts";

import { nodeAddressSchema } from "./certs.ts";
import { ARTIFACT_TARGET, NODE } from "./machine.ts";
import { NODE_NAMES, type NodeName } from "./topology.ts";
import { assetOf, DOCUMENTED, RELEASE, versionSchema } from "./yugabyte.ts";

// Shell lines for Systems Manager Run Command. Nothing here runs anything:
// scripts/nodes.ts does, and tests read what it would run.

export type Addresses = Record<NodeName, string>;
export const addressesSchema = v.object({
  a: nodeAddressSchema,
  b: nodeAddressSchema,
  c: nodeAddressSchema,
});
const base64Schema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9+/=]+$/), v.maxLength(8000));

// #region commands
/** Each line is built from validated pieces only. */
export const nodeCommands = {
  status: (): string[] => [
    "cloud-init status --long || true",
    `findmnt --noheadings --output SOURCE,TARGET,FSTYPE ${NODE.mount} || echo "${NODE.mount} is not mounted"`,
    `readlink ${NODE.current} || echo "YugabyteDB is not installed"`,
    "systemctl is-active yb-master.service yb-tserver.service || true",
    // The clock: how far off, and from which source. The database stops itself past max_clock_skew_usec.
    "chronyc tracking | grep -E 'Reference ID|System time|Root dispersion' || true",
  ],
  // The version and the digest are the ones pinned in src/yugabyte.ts at the moment of the call.
  install: (bucket: string): string[] => [
    `${NODE.scripts.install} ${v.parse(bucketNameSchema, bucket)} ${v.parse(versionSchema, RELEASE.version)} ${RELEASE.build} ${assetOf(ARTIFACT_TARGET).sha256}`,
  ],
  csr: (): string[] => [NODE.scripts.csr],
  certificate: (certificate: string, ca: string): string[] => [
    `${NODE.scripts.certificate} ${v.parse(base64Schema, certificate)} ${v.parse(base64Schema, ca)}`,
  ],
  configure: (node: NodeName, addresses: Addresses): string[] => {
    const parsed = v.parse(addressesSchema, addresses);
    return [
      `${NODE.scripts.configure} ${v.parse(v.picklist(NODE_NAMES), node)} ${parsed.a} ${parsed.b} ${parsed.c}`,
    ];
  },
  start: (process: "master" | "tserver"): string[] => [
    "set -euo pipefail",
    `systemctl start yb-${process}.service`,
    "sleep 5",
    `systemctl is-active yb-${process}.service`,
  ],
  // SIGTERM. The other two nodes elect new leaders for the tablets this one led.
  stop: (process: "master" | "tserver"): string[] => [
    "set -euo pipefail",
    `systemctl stop yb-${process}.service`,
    `systemctl is-active yb-${process}.service && exit 1 || echo "yb-${process} is stopped"`,
  ],
  // What the masters know: which servers are dead, and which tablets have fewer copies than they should.
  health: (address: string): string[] => [
    `curl -fsS --max-time 10 http://${v.parse(nodeAddressSchema, address)}:${DOCUMENTED.ports.masterWeb}/api/v1/health-check`,
    "echo",
  ],
  logs: (process: "master" | "tserver"): string[] => [
    `journalctl --unit yb-${process}.service --no-pager --lines 40`,
    `tail -n 40 ${NODE.dataDir}/yb-data/${process}/logs/yb-${process}.INFO || true`,
  ],
};
// #endregion commands

// #region health
/** The master's `/api/v1/health-check`, as the pinned version answered on a laptop. */
export const healthSchema = v.object({
  dead_nodes: v.array(v.string()),
  under_replicated_tablets: v.array(v.string()),
});
export type Health = v.InferOutput<typeof healthSchema>;

/** Safe to take the next node down: nothing is dead, and every tablet has all its copies. */
export const fullyReplicated = (health: Health): boolean =>
  health.dead_nodes.length === 0 && health.under_replicated_tablets.length === 0;
// #endregion health
