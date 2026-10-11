import { describe, expect, it } from "vite-plus/test";
import { EGRESS_MODES, parseNetworkConfig } from "../src/config.ts";
import { planNetwork } from "../src/plan.ts";
import { type Destination, pathFrom } from "../src/reach.ts";
import { describePlan } from "../src/report.ts";

const plan = (input: unknown = {}) => planNetwork(parseNetworkConfig(input));
const internet: Destination = { kind: "internet" };
const service = (name: string): Destination => ({ kind: "aws-service", service: name });

const ZONE_A = "ap-northeast-1a";
const ZONE_C = "ap-northeast-1c";

describe("reachability from the route tables", () => {
  it("lets a private subnet reach S3 and DynamoDB, and nothing else outside the VPC", () => {
    const planned = plan();
    expect(pathFrom(planned, "Private1", service("s3"))).toEqual({ reachable: true, via: "gateway-endpoint" });
    expect(pathFrom(planned, "Private1", service("dynamodb"))).toEqual({ reachable: true, via: "gateway-endpoint" });
    expect(pathFrom(planned, "Private1", internet)).toEqual({ reachable: false, reason: "no-route" });
    // ECR is an AWS service too, but its API lives on the internet side of the route table.
    expect(pathFrom(planned, "Private1", service("ecr.api"))).toEqual({ reachable: false, reason: "no-route" });
    expect(pathFrom(planned, "Public1", internet)).toEqual({ reachable: true, via: "internet-gateway" });
  });

  it("opens one service per interface endpoint without opening the internet", () => {
    const planned = plan({ interfaceEndpoints: "ecr.api,ecr.dkr,logs" });
    expect(pathFrom(planned, "Private2", service("ecr.api"))).toEqual({ reachable: true, via: "interface-endpoint" });
    expect(pathFrom(planned, "Private2", service("ssm"))).toEqual({ reachable: false, reason: "no-route" });
    expect(pathFrom(planned, "Private2", internet)).toEqual({ reachable: false, reason: "no-route" });
  });

  it("rejects a subnet the plan does not have", () => {
    expect(() => pathFrom(plan(), "Private9", internet)).toThrow(/no subnet "Private9"/);
  });
});

describe("one zone going down, step by step", () => {
  // #region zone-failure
  it("cuts the healthy zone off the internet when the only NAT gateway was in the other one", () => {
    const planned = plan({ egress: "nat" });

    // 1. Both zones up: the subnet in zone C leaves through the NAT gateway in zone A.
    expect(pathFrom(planned, "Private2", internet)).toEqual({ reachable: true, via: "nat-gateway" });

    // 2. Zone A goes down. Zone C itself is fine, and still loses its way out.
    expect(pathFrom(planned, "Private1", internet, [ZONE_A])).toEqual({ reachable: false, reason: "zone-down" });
    expect(pathFrom(planned, "Private2", internet, [ZONE_A])).toEqual({ reachable: false, reason: "nat-zone-down" });

    // 3. What does not pass through the NAT gateway keeps working from zone C.
    expect(pathFrom(planned, "Private2", service("s3"), [ZONE_A])).toEqual({
      reachable: true,
      via: "gateway-endpoint",
    });

    // 4. Had zone C failed instead, zone A would not have noticed.
    expect(pathFrom(planned, "Private1", internet, [ZONE_C])).toEqual({ reachable: true, via: "nat-gateway" });
  });
  // #endregion zone-failure

  it("keeps the healthy zone connected when every zone has its own NAT gateway", () => {
    const planned = plan({ egress: "nat-per-az" });
    expect(pathFrom(planned, "Private2", internet, [ZONE_A])).toEqual({ reachable: true, via: "nat-gateway" });
    expect(pathFrom(planned, "Private1", internet, [ZONE_C])).toEqual({ reachable: true, via: "nat-gateway" });
  });

  it("leaves nothing reachable in any layout once every zone of the region is down", () => {
    for (const egress of EGRESS_MODES) {
      const planned = plan({ egress, interfaceEndpoints: "ecr.api" });
      for (const subnet of planned.subnets) {
        for (const destination of [internet, service("s3"), service("ecr.api")]) {
          expect(pathFrom(planned, subnet.id, destination, [ZONE_A, ZONE_C])).toEqual({
            reachable: false,
            reason: "zone-down",
          });
        }
      }
    }
  });
});

describe("the printed plan", () => {
  it("shows the default layout as free of hourly charges", () => {
    expect(describePlan(plan())).toEqual([
      "VPC 10.20.0.0/16 (ap-northeast-1)",
      "",
      "Public1   ap-northeast-1a  10.20.0.0/20        4091 usable  0.0.0.0/0 -> internet gateway",
      "Public2   ap-northeast-1c  10.20.16.0/20       4091 usable  0.0.0.0/0 -> internet gateway",
      "Private1  ap-northeast-1a  10.20.128.0/20      4091 usable  no route out of the VPC",
      "Private2  ap-northeast-1c  10.20.144.0/20      4091 usable  no route out of the VPC",
      "",
      "From Private1:",
      "  the internet  unreachable (no-route)",
      "  s3            via gateway-endpoint",
      "  dynamodb      via gateway-endpoint",
      "  ecr.api       unreachable (no-route)",
      "  logs          unreachable (no-route)",
      "  ssm           unreachable (no-route)",
      "",
      "Billed by the hour, used or not:",
      "  nothing",
    ]);
  });

  it("names the zone a private subnet depends on for its NAT gateway", () => {
    const lines = describePlan(plan({ egress: "nat" }));
    expect(lines).toContain(
      "Private1  ap-northeast-1a  10.20.128.0/20      4091 usable  0.0.0.0/0 -> NAT gateway in the same zone",
    );
    expect(lines).toContain(
      "Private2  ap-northeast-1c  10.20.144.0/20      4091 usable  0.0.0.0/0 -> NAT gateway in ap-northeast-1a",
    );
  });
});
