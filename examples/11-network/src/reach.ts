import type { NetworkPlan } from "./plan.ts";

// A model of the plan's route tables, for reasoning and tests. It does not
// look at security groups, network ACLs, or DNS, and it never asks AWS.

// #region reach
export type Destination = { kind: "internet" } | { kind: "aws-service"; service: string };

export type Path =
  | {
      reachable: true;
      via: "internet-gateway" | "nat-gateway" | "gateway-endpoint" | "interface-endpoint";
    }
  | { reachable: false; reason: "zone-down" | "no-route" | "nat-zone-down" };

/** Can something in `subnetId` open a connection to `destination`, with `downZones` out of service? */
export function pathFrom(
  plan: NetworkPlan,
  subnetId: string,
  destination: Destination,
  downZones: readonly string[] = [],
): Path {
  const subnet = plan.subnets.find((candidate) => candidate.id === subnetId);
  if (subnet === undefined) {
    throw new Error(`the plan has no subnet "${subnetId}"`);
  }
  if (downZones.includes(subnet.availabilityZone)) {
    return { reachable: false, reason: "zone-down" };
  }

  if (destination.kind === "aws-service") {
    // A gateway endpoint is a route in the private route tables, not a thing placed in a zone.
    const gateway = (plan.gatewayEndpoints as readonly string[]).includes(destination.service);
    if (gateway && subnet.tier === "private") {
      return { reachable: true, via: "gateway-endpoint" };
    }
    // An interface endpoint has a network interface in every private subnet,
    // and its private DNS name resolves anywhere in the VPC.
    if ((plan.interfaceEndpoints as readonly string[]).includes(destination.service)) {
      return { reachable: true, via: "interface-endpoint" };
    }
  }

  // Everything else follows 0.0.0.0/0, if the route table has it.
  const route = subnet.defaultRoute;
  if (route === null) {
    return { reachable: false, reason: "no-route" };
  }
  if (route.via === "internet-gateway") {
    // True only for resources that also hold a public IPv4 address.
    return { reachable: true, via: "internet-gateway" };
  }
  return downZones.includes(route.availabilityZone)
    ? { reachable: false, reason: "nat-zone-down" }
    : { reachable: true, via: "nat-gateway" };
}
// #endregion reach
