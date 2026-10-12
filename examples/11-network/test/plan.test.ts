import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { containsCidr, overlaps, parseCidr } from "../src/cidr.ts";
import { networkConfigSchema, parseNetworkConfig } from "../src/config.ts";
import { fixedMonthlyItems } from "../src/cost.ts";
import { planNetwork, subnetsOf } from "../src/plan.ts";

const plan = (input: unknown = {}) => planNetwork(parseNetworkConfig(input));

describe("network settings", () => {
  it("default to two zones and nothing billed by the hour", () => {
    expect(parseNetworkConfig({})).toEqual({
      cidr: "10.20.0.0/16",
      availabilityZones: ["ap-northeast-1a", "ap-northeast-1c"],
      subnetPrefix: 20,
      egress: "none",
      interfaceEndpoints: [],
    });
  });

  it("accept the strings that `-c key=value` delivers", () => {
    const config = parseNetworkConfig({
      availabilityZones: "ap-northeast-1a, ap-northeast-1c,ap-northeast-1d",
      subnetPrefix: "22",
      egress: "nat",
      interfaceEndpoints: "ecr.api,ecr.dkr,logs",
    });
    expect(config.availabilityZones).toHaveLength(3);
    expect(config.subnetPrefix).toBe(22);
    expect(config.interfaceEndpoints).toEqual(["ecr.api", "ecr.dkr", "logs"]);
  });

  it.each([
    [{ cidr: "8.8.0.0/16" }, "cidr", /not inside 10\.0\.0\.0\/8/],
    [{ cidr: "10.20.1.0/16" }, "cidr", /host bits set/],
    [{ cidr: "10.0.0.0/8" }, "cidr", /outside \/16 to \/24/],
    [{ availabilityZones: "ap-northeast-1a" }, "availabilityZones", /.+/],
    [{ availabilityZones: "ap-northeast-1a,ap-northeast-1a" }, "availabilityZones", /listed twice/],
    [{ availabilityZones: "us-east-1a,us-east-1b" }, "availabilityZones.0", /.+/],
    [{ egress: "instance" }, "egress", /.+/],
    [{ interfaceEndpoints: "s3" }, "interfaceEndpoints.0", /.+/],
    [{ interfaceEndpoints: "logs,logs" }, "interfaceEndpoints", /listed twice/],
    [{ subnetPrefix: "29" }, "subnetPrefix", /.+/],
    // Half of a /24 is a /25: room for two /26, not three.
    [
      {
        cidr: "10.20.0.0/24",
        subnetPrefix: 26,
        availabilityZones: "ap-northeast-1a,ap-northeast-1c,ap-northeast-1d",
      },
      "subnetPrefix",
      /holds 2 subnets of \/26, but 3 zones/,
    ],
    [{ cidr: "10.20.0.0/24", subnetPrefix: 24 }, "subnetPrefix", /holds 0 subnets/],
  ])("reject %j at %s", (input, path, message) => {
    const result = v.safeParse(networkConfigSchema, input);
    expect(result.success).toBe(false);
    const issue = result.issues?.find((item) => v.getDotPath(item) === path);
    expect(issue?.message).toMatch(message);
  });

  it("name every bad field in one error", () => {
    expect(() => parseNetworkConfig({ subnetPrefix: "29", egress: "instance" })).toThrow(
      /Invalid network settings:\n {2}subnetPrefix: .+\n {2}egress: /,
    );
    // Checks that span fields (ranges, room for the zones) wait until each field is valid on its own.
    expect(() =>
      parseNetworkConfig({
        cidr: "8.8.0.0/16",
        availabilityZones: "ap-northeast-1a,ap-northeast-1a",
      }),
    ).toThrow(/Invalid network settings:\n {2}cidr: .+\n {2}availabilityZones: /);
  });
});

describe("the plan", () => {
  it("puts public subnets in the lower half and private ones in the upper half", () => {
    expect(
      plan().subnets.map(({ id, availabilityZone, cidr }) => [id, availabilityZone, cidr]),
    ).toEqual([
      ["Public1", "ap-northeast-1a", "10.20.0.0/20"],
      ["Public2", "ap-northeast-1c", "10.20.16.0/20"],
      ["Private1", "ap-northeast-1a", "10.20.128.0/20"],
      ["Private2", "ap-northeast-1c", "10.20.144.0/20"],
    ]);
  });

  it("never overlaps two subnets or leaves the VPC, whatever the settings", () => {
    const zones = ["ap-northeast-1a", "ap-northeast-1c", "ap-northeast-1d"];
    for (const cidr of ["10.20.0.0/16", "172.31.0.0/20", "192.168.8.0/22"]) {
      const vpcPrefix = parseCidr(cidr).prefix;
      for (const zoneCount of [2, 3]) {
        // The smallest and the largest subnet that still gives every zone a block.
        for (const subnetPrefix of [vpcPrefix + 1 + Math.ceil(Math.log2(zoneCount)), 28]) {
          const planned = plan({
            cidr,
            subnetPrefix,
            availabilityZones: zones.slice(0, zoneCount),
          });
          const blocks = planned.subnets.map((subnet) => parseCidr(subnet.cidr));
          expect(blocks).toHaveLength(zoneCount * 2);
          blocks.forEach((block, index) => {
            expect(
              containsCidr(parseCidr(planned.vpcCidr), block),
              `${subnetPrefix} in ${cidr}`,
            ).toBe(true);
            for (const other of blocks.slice(index + 1)) {
              expect(overlaps(block, other), `${planned.subnets[index]?.cidr} in ${cidr}`).toBe(
                false,
              );
            }
          });
        }
      }
    }
  });

  it("gives private subnets no route out, and nothing with an hourly price, by default", () => {
    const planned = plan();
    expect(subnetsOf(planned, "private").map((subnet) => subnet.defaultRoute)).toEqual([
      null,
      null,
    ]);
    expect(subnetsOf(planned, "public").map((subnet) => subnet.defaultRoute)).toEqual([
      { via: "internet-gateway" },
      { via: "internet-gateway" },
    ]);
    expect(planned.natGateways).toEqual([]);
    expect(planned.interfaceEndpoints).toEqual([]);
    expect(fixedMonthlyItems(planned)).toEqual([]);
  });

  it("sends every private subnet to the one NAT gateway with `nat`", () => {
    const planned = plan({ egress: "nat" });
    expect(planned.natGateways).toEqual([
      { availabilityZone: "ap-northeast-1a", subnetId: "Public1" },
    ]);
    expect(subnetsOf(planned, "private").map((subnet) => subnet.defaultRoute)).toEqual([
      { via: "nat-gateway", availabilityZone: "ap-northeast-1a" },
      { via: "nat-gateway", availabilityZone: "ap-northeast-1a" },
    ]);
  });

  it("keeps each private subnet on its own zone's NAT gateway with `nat-per-az`", () => {
    const planned = plan({ egress: "nat-per-az" });
    expect(planned.natGateways.map((nat) => nat.subnetId)).toEqual(["Public1", "Public2"]);
    for (const subnet of subnetsOf(planned, "private")) {
      expect(subnet.defaultRoute).toEqual({
        via: "nat-gateway",
        availabilityZone: subnet.availabilityZone,
      });
    }
  });

  it("bills an interface endpoint once per zone, and a NAT gateway together with its address", () => {
    expect(
      fixedMonthlyItems(plan({ egress: "nat-per-az", interfaceEndpoints: "ecr.api,ecr.dkr,logs" })),
    ).toEqual([
      { priceId: "nat.gateway.hour", quantity: 1460, basis: "2 NAT gateways x 730 hours" },
      {
        priceId: "vpc.public-ipv4.in-use.hour",
        quantity: 1460,
        basis: "2 Elastic IP addresses x 730 hours",
      },
      {
        priceId: "vpc.endpoint.interface.hour",
        quantity: 4380,
        basis: "3 interface endpoints x 2 zones x 730 hours",
      },
    ]);
  });
});
