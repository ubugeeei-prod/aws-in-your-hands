import { type NetworkPlan, subnetsOf } from "./plan.ts";

// #region billable
/** The book's month. data/pricing/scenarios.json uses the same number. */
export const MONTH_HOURS = 730;

/** IDs in data/pricing/unit-prices.json. */
export const PRICE_IDS = {
  natGatewayHour: "nat.gateway.hour",
  publicIpv4Hour: "vpc.public-ipv4.in-use.hour",
  interfaceEndpointHour: "vpc.endpoint.interface.hour",
} as const;

export type FixedItem = { priceId: string; quantity: number; basis: string };

const count = (value: number, one: string, many: string): string => `${value} ${value === 1 ? one : many}`;

/** What the plan is billed for while no traffic flows. Data processing and transfer come on top. */
export function fixedMonthlyItems(plan: NetworkPlan, hours: number = MONTH_HOURS): FixedItem[] {
  const nat = plan.natGateways.length;
  const zones = subnetsOf(plan, "private").length;
  const endpoints = plan.interfaceEndpoints.length;
  const items: FixedItem[] = [];
  if (nat > 0) {
    items.push(
      {
        priceId: PRICE_IDS.natGatewayHour,
        quantity: nat * hours,
        basis: `${count(nat, "NAT gateway", "NAT gateways")} x ${hours} hours`,
      },
      // Each NAT gateway holds one Elastic IP address, billed like any public IPv4 address.
      {
        priceId: PRICE_IDS.publicIpv4Hour,
        quantity: nat * hours,
        basis: `${count(nat, "Elastic IP address", "Elastic IP addresses")} x ${hours} hours`,
      },
    );
  }
  if (endpoints > 0) {
    items.push({
      priceId: PRICE_IDS.interfaceEndpointHour,
      // An interface endpoint is billed once per zone it has a network interface in.
      quantity: endpoints * zones * hours,
      basis: `${count(endpoints, "interface endpoint", "interface endpoints")} x ${count(zones, "zone", "zones")} x ${hours} hours`,
    });
  }
  return items;
}
// #endregion billable
