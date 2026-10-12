import { describe, expect, it } from "vite-plus/test";

import { parseNetworkConfig } from "@aih/example-11-network/src/config.ts";
import { planNetwork } from "@aih/example-11-network/src/plan.ts";

import { checkAccess, NETWORK_SETTINGS, unreachable } from "../src/network.ts";

const plan = (settings: Record<string, string>) => planNetwork(parseNetworkConfig(settings));

describe("what the instances can reach from the chapter 11 subnets", () => {
  it("is nothing in the default network: the function would run and its logs would go nowhere", () => {
    expect(unreachable(checkAccess(plan({})))).toEqual([
      "logs from Private1",
      "logs from Private2",
    ]);
  });

  it("is CloudWatch Logs from both zones once the network has the endpoint", () => {
    const checks = checkAccess(plan(NETWORK_SETTINGS));
    expect(unreachable(checks)).toEqual([]);
    expect(checks.map((check) => check.path)).toEqual([
      { reachable: true, via: "interface-endpoint" },
      { reachable: true, via: "interface-endpoint" },
    ]);
  });

  it("is also CloudWatch Logs through a NAT gateway, at a NAT gateway's price", () => {
    expect(unreachable(checkAccess(plan({ egress: "nat" })))).toEqual([]);
  });
});
