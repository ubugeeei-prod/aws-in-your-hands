import { fixedMonthlyItems } from "@aih/example-11-network/src/cost.ts";
import type { NetworkPlan } from "@aih/example-11-network/src/plan.ts";
import { checkAccess, subnetFor } from "./access.ts";
import type { Ec2Config } from "./config.ts";
import { type FixedItem, fixedItems, type InstanceState } from "./cost.ts";

// #region report
/** Everything billed by the hour or the month for this instance and the network it needs. */
export function allFixedItems(
  config: Ec2Config,
  network: NetworkPlan,
  state: InstanceState,
  hours: number,
): FixedItem[] {
  return [...fixedItems(config, state, hours), ...fixedMonthlyItems(network, hours)];
}

/** What `vp run ec2:plan` prints, without the prices. Same input, same output. */
export function describePlan(config: Ec2Config, network: NetworkPlan): string[] {
  const subnetId = subnetFor(config.placement);
  const subnet = network.subnets.find((candidate) => candidate.id === subnetId);
  const lines = [
    `Instance  ${config.instanceType}, Amazon Linux 2023 arm64, ${config.amiId ?? "latest AMI at deploy time"}`,
    `Subnet    ${subnetId} (${subnet?.availabilityZone ?? "?"}), ${config.placement === "public" ? "with a public IPv4 address" : "no public address"}`,
    `Inbound   nothing (no SSH, no HTTP)`,
    `Data      ${config.dataVolumeGiB} GiB gp3 in ${subnet?.availabilityZone ?? "?"}; on stack destroy: ${config.dataOnDestroy}`,
    "",
    `From ${subnetId}, on port 443:`,
  ];
  for (const check of checkAccess(config.placement, network)) {
    const result = check.path.reachable ? `via ${check.path.via}` : `UNREACHABLE (${check.path.reason})`;
    lines.push(`  ${check.service.padEnd(12)} ${result}`);
  }
  return lines;
}
// #endregion report
