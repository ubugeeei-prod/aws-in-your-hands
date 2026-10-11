import { fixedMonthlyItems } from "./cost.ts";
import type { NetworkPlan } from "./plan.ts";
import { pathFrom } from "./reach.ts";

// #region report
/** What `vp run net:plan` prints, without the prices. Plain text, same input gives same output. */
export function describePlan(plan: NetworkPlan): string[] {
  const lines = [`VPC ${plan.vpcCidr} (${plan.region})`, ""];

  for (const subnet of plan.subnets) {
    const route =
      subnet.defaultRoute === null
        ? "no route out of the VPC"
        : subnet.defaultRoute.via === "internet-gateway"
          ? "0.0.0.0/0 -> internet gateway"
          : `0.0.0.0/0 -> NAT gateway in ${subnet.availabilityZone === subnet.defaultRoute.availabilityZone ? "the same zone" : subnet.defaultRoute.availabilityZone}`;
    lines.push(
      `${subnet.id.padEnd(9)} ${subnet.availabilityZone}  ${subnet.cidr.padEnd(18)} ${String(subnet.usableAddresses).padStart(5)} usable  ${route}`,
    );
  }

  const firstPrivate = plan.subnets.find((subnet) => subnet.tier === "private");
  if (firstPrivate !== undefined) {
    lines.push("", `From ${firstPrivate.id}:`);
    const destinations = [
      { label: "the internet", destination: { kind: "internet" } as const },
      ...["s3", "dynamodb", "ecr.api", "logs", "ssm"].map((service) => ({
        label: service,
        destination: { kind: "aws-service", service } as const,
      })),
    ];
    for (const { label, destination } of destinations) {
      const path = pathFrom(plan, firstPrivate.id, destination);
      lines.push(`  ${label.padEnd(13)} ${path.reachable ? `via ${path.via}` : `unreachable (${path.reason})`}`);
    }
  }

  const items = fixedMonthlyItems(plan);
  lines.push("", "Billed by the hour, used or not:");
  if (items.length === 0) {
    lines.push("  nothing");
  }
  for (const item of items) {
    lines.push(`  ${item.priceId.padEnd(28)} ${String(item.quantity).padStart(5)} hours  (${item.basis})`);
  }
  return lines;
}
// #endregion report
