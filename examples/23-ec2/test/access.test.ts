import { parseNetworkConfig } from "@aih/example-11-network/src/config.ts";
import { planNetwork } from "@aih/example-11-network/src/plan.ts";
import { pathFrom } from "@aih/example-11-network/src/reach.ts";
import { describe, expect, it } from "vite-plus/test";
import { checkAccess, REQUIRED_SERVICES, subnetFor, unreachable } from "../src/access.ts";
import { parseEc2Config } from "../src/config.ts";
import { networkSettingsFor } from "../src/cost.ts";
import { describePlan } from "../src/report.ts";

const network = (settings: unknown = {}) => planNetwork(parseNetworkConfig(settings));

describe("the path from the instance to Systems Manager", () => {
  it("does not exist in a private subnet of the default chapter 11 network", () => {
    // The instance would boot, run its user data, and never appear in Systems Manager.
    expect(unreachable(checkAccess("private", network()))).toEqual(["ssm", "ssmmessages", "ec2messages"]);
  });

  it("exists once the network has the three interface endpoints this chapter asks for", () => {
    const checks = checkAccess("private", network(networkSettingsFor("private")));
    expect(unreachable(checks)).toEqual([]);
    expect(checks.map((check) => [check.service, check.path.reachable && check.path.via])).toEqual([
      ["ssm", "interface-endpoint"],
      ["ssmmessages", "interface-endpoint"],
      ["ec2messages", "interface-endpoint"],
      // Package repositories and releases come through the endpoint that costs nothing.
      ["s3", "gateway-endpoint"],
    ]);
  });

  it("is missing a piece when one endpoint is left out", () => {
    expect(unreachable(checkAccess("private", network({ interfaceEndpoints: "ssm,ec2messages" })))).toEqual([
      "ssmmessages",
    ]);
  });

  it("also exists through a NAT gateway, or from a public subnet, without any endpoint", () => {
    expect(unreachable(checkAccess("private", network({ egress: "nat" })))).toEqual([]);
    expect(unreachable(checkAccess("public", network()))).toEqual([]);
    expect(networkSettingsFor("public")).toEqual({});
  });

  it("warns in the printed plan", () => {
    const lines = describePlan(parseEc2Config({}), network()).join("\n");
    expect(lines).toContain("ssm          UNREACHABLE (no-route)");
    expect(lines).toContain("Inbound   nothing");
  });
});

describe("one instance is one zone", () => {
  // The invariant this chapter cannot offer: "the API answers while one zone is down".
  it.each(["private", "public"] as const)("a %s instance reaches nothing when its zone is down", (placement) => {
    const plan = network({ ...networkSettingsFor(placement), egress: "nat-per-az" });
    const subnet = plan.subnets.find((candidate) => candidate.id === subnetFor(placement));

    for (const service of REQUIRED_SERVICES) {
      expect(
        pathFrom(plan, subnetFor(placement), { kind: "aws-service", service }, [subnet?.availabilityZone ?? ""]),
      ).toEqual({ reachable: false, reason: "zone-down" });
    }
  });

  it("keeps its path when only the other zone is down", () => {
    const plan = network(networkSettingsFor("private"));
    expect(pathFrom(plan, "Private1", { kind: "aws-service", service: "ssm" }, ["ap-northeast-1c"]).reachable).toBe(
      true,
    );
  });
});
