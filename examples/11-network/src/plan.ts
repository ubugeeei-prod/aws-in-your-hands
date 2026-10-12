import { formatCidr, parseCidr, subnetAt, usableAddresses } from "./cidr.ts";
import { type InterfaceService, type NetworkConfig, REGION } from "./config.ts";

// #region types
export type Tier = "public" | "private";

/** Where 0.0.0.0/0 goes. `null`: the route table has no such route. */
export type DefaultRoute =
  | null
  | { via: "internet-gateway" }
  | { via: "nat-gateway"; availabilityZone: string };

export type SubnetPlan = {
  /** "Public1", "Private2": also the logical ID in the stack and the name in exports. */
  id: string;
  tier: Tier;
  availabilityZone: string;
  cidr: string;
  usableAddresses: number;
  defaultRoute: DefaultRoute;
};

export type NetworkPlan = {
  region: typeof REGION;
  vpcCidr: string;
  subnets: SubnetPlan[];
  /** One entry per NAT gateway, with the public subnet it sits in. */
  natGateways: { availabilityZone: string; subnetId: string }[];
  /** Attached to the private route tables. No hourly charge. */
  gatewayEndpoints: readonly ("s3" | "dynamodb")[];
  /** One network interface per private subnet each. Billed per zone, per hour. */
  interfaceEndpoints: InterfaceService[];
};
// #endregion types

// #region plan
export function planNetwork(config: NetworkConfig): NetworkPlan {
  const vpc = parseCidr(config.cidr);
  const zones = config.availabilityZones;
  // Lower half for public subnets, upper half for private ones. A third zone
  // or a larger subnet can be added later without renumbering what exists.
  const half = {
    public: subnetAt(vpc, vpc.prefix + 1, 0),
    private: subnetAt(vpc, vpc.prefix + 1, 1),
  };

  const natZones =
    config.egress === "none" ? [] : config.egress === "nat" ? zones.slice(0, 1) : zones;
  const natFor = (zone: string): string | undefined =>
    natZones.includes(zone) ? zone : natZones[0];

  const subnet = (tier: Tier, zone: string, index: number): SubnetPlan => {
    const cidr = subnetAt(half[tier], config.subnetPrefix, index);
    const nat = natFor(zone);
    return {
      id: `${tier === "public" ? "Public" : "Private"}${index + 1}`,
      tier,
      availabilityZone: zone,
      cidr: formatCidr(cidr),
      usableAddresses: usableAddresses(cidr),
      defaultRoute:
        tier === "public"
          ? { via: "internet-gateway" }
          : nat === undefined
            ? null
            : { via: "nat-gateway", availabilityZone: nat },
    };
  };

  return {
    region: REGION,
    vpcCidr: formatCidr(vpc),
    subnets: [
      ...zones.map((zone, index) => subnet("public", zone, index)),
      ...zones.map((zone, index) => subnet("private", zone, index)),
    ],
    natGateways: natZones.map((zone) => ({
      availabilityZone: zone,
      subnetId: `Public${zones.indexOf(zone) + 1}`,
    })),
    gatewayEndpoints: ["s3", "dynamodb"],
    interfaceEndpoints: [...config.interfaceEndpoints],
  };
}
// #endregion plan

export const subnetsOf = (plan: NetworkPlan, tier: Tier): SubnetPlan[] =>
  plan.subnets.filter((subnet) => subnet.tier === tier);
