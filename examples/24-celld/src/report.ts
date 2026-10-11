import { parseNetworkConfig } from "@aih/example-11-network/src/config.ts";
import { planNetwork } from "@aih/example-11-network/src/plan.ts";
import { checkAccess, unreachable } from "@aih/example-23-ec2/src/access.ts";
import { networkSettingsFor } from "@aih/example-23-ec2/src/cost.ts";
import { PINNED_VERSION, RELEASES } from "./celld.ts";
import { type FleetConfig, nodeNames } from "./config.ts";
import { nodeSpec } from "./machine.ts";

// #region plan
/** What celld gets from a fleet of this size. Each line is celld's documentation, not an observation. */
export function durabilityOf(nodes: number): string {
  if (nodes === 0) {
    return "no node: the bucket, the role, and the security group only";
  }
  if (nodes === 1) {
    return "one node: every write waits for the bucket; nobody takes over while it is down";
  }
  if (nodes === 2) {
    return "two nodes: a write is acknowledged once the other node holds it on disk or the bucket has it; until the upload, the only copies are on those two disks";
  }
  return "three nodes: the owner recruits two followers, so the fleet holds three copies of an acknowledged write";
}

/** What `vp run celld:plan` prints, without the prices. Same input, same output. */
export function describePlan(config: FleetConfig): { lines: string[]; missing: string[] } {
  const spec = nodeSpec();
  const settings = config.nodes > 0 ? networkSettingsFor("private") : {};
  const network = planNetwork(parseNetworkConfig(settings));
  const privateSubnets = network.subnets.filter((subnet) => subnet.id.startsWith("Private"));
  const flags = Object.entries(settings).map(([key, value]) => ` -c ${key}=${value}`);
  const lines = [
    `celld     ${PINNED_VERSION} (${RELEASES[PINNED_VERSION].commit.slice(0, 12)}), beta, self-operated`,
    `Network   vp run net:infra:deploy${flags.join("")}`,
    `Fleet     ${durabilityOf(config.nodes)}`,
    ...nodeNames(config.nodes).map((node, index) => {
      const subnet = privateSubnets[index % privateSubnets.length];
      const snapshot = config.dataSnapshots[node];
      return `  node ${node}  ${config.instanceType} in ${subnet?.id ?? "?"} (${subnet?.availabilityZone ?? "?"}), ${config.dataVolumeGiB} GiB data${snapshot === undefined ? "" : ` from ${snapshot}`}`;
    }),
    `Inbound   tcp ${spec.internalPort} from the nodes' own security group; nothing else`,
    `Worker    127.0.0.1:${spec.publicPort} on each node; no load balancer, no public address`,
    `State     bucket and data volumes on stack destroy: ${config.stateOnDestroy}`,
  ];
  // Reuses chapter 23's check: can a private instance reach Systems Manager and S3 at all?
  const missing = config.nodes > 0 ? unreachable(checkAccess("private", network)) : [];
  return { lines, missing };
}
// #endregion plan
