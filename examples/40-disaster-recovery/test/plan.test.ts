import { describe, expect, it } from "vite-plus/test";

import { parseNetworkConfig } from "@aih/example-11-network/src/config.ts";
import { planNetwork } from "@aih/example-11-network/src/plan.ts";
import { networkSettingsFor } from "@aih/example-23-ec2/src/cost.ts";

import { parseDrConfig } from "../src/config.ts";
import { checkPaths, sourceSubnet, stagingSubnet, unreachable } from "../src/network.ts";
import { blockers, checkSource, kernelVersion, type SourceFacts } from "../src/source.ts";
import {
  launchTemplate,
  oldestRecoveryPoint,
  pitPolicy,
  replicationTemplate,
  setupCommands,
} from "../src/templates.ts";

const graviton: SourceFacts = {
  os: "amazon-linux-2023",
  kernel: "6.1.158-180.294.amzn2023.aarch64",
  architecture: "aarch64",
  origin: "ec2",
  mountedDisks: 2,
};

describe("whether the instance can be a source server", () => {
  it("accepts a Graviton instance on a 6.1 kernel", () => {
    expect(blockers(checkSource(graviton))).toEqual([]);
  });

  it("accepts 6.12 and refuses anything newer on Amazon Linux 2023", () => {
    expect(blockers(checkSource({ ...graviton, kernel: "6.12.40-1.amzn2023.aarch64" }))).toEqual(
      [],
    );
    expect(blockers(checkSource({ ...graviton, kernel: "6.18" }))).toHaveLength(1);
    expect(blockers(checkSource({ ...graviton, kernel: "7.0.1" }))).toHaveLength(1);
  });

  it("refuses arm64 outside EC2", () => {
    const findings = blockers(checkSource({ ...graviton, origin: "elsewhere" }));
    expect(findings[0]?.message).toContain("arm64");
  });

  it("refuses a kernel string it cannot read and a server with nothing mounted", () => {
    expect(kernelVersion("unknown")).toBeNull();
    expect(blockers(checkSource({ ...graviton, kernel: "unknown" }))).toHaveLength(1);
    expect(blockers(checkSource({ ...graviton, mountedDisks: 0 }))).toHaveLength(1);
  });
});

describe("the paths the agent and the staging area need", () => {
  const network = (settings: Record<string, string>) => planNetwork(parseNetworkConfig(settings));

  it("puts the staging area in the zone the source is not in", () => {
    const plan = network({});
    const zoneOf = (id: string) =>
      plan.subnets.find((subnet) => subnet.id === id)?.availabilityZone;
    for (const placement of ["private", "public"] as const) {
      expect(zoneOf(stagingSubnet(placement))).not.toBe(zoneOf(sourceSubnet(placement)));
    }
  });

  it("reaches everything from private subnets with this stack's endpoints and no NAT", () => {
    const checks = checkPaths("private", network(networkSettingsFor("private")));
    expect(unreachable(checks)).toEqual([]);
    expect(
      checks.map((check) => [check.from, check.service, check.path.reachable && check.path.via]),
    ).toEqual([
      ["source", "drs", "interface-endpoint"],
      ["source", "s3", "gateway-endpoint"],
      ["staging", "drs", "interface-endpoint"],
      ["staging", "ec2", "interface-endpoint"],
      ["staging", "s3", "gateway-endpoint"],
    ]);
  });

  it("goes through the internet gateway from public subnets", () => {
    const checks = checkPaths("public", network({}));
    expect(new Set(checks.map((check) => check.path.reachable && check.path.via))).toEqual(
      new Set(["internet-gateway"]),
    );
  });
});

describe("the two templates", () => {
  const config = parseDrConfig({});

  it("has exactly three point-in-time rules, and only the days follow the setting", () => {
    expect(pitPolicy(14)).toEqual([
      { ruleID: 1, units: "MINUTE", interval: 10, retentionDuration: 60, enabled: true },
      { ruleID: 2, units: "HOUR", interval: 1, retentionDuration: 24, enabled: true },
      { ruleID: 3, units: "DAY", interval: 1, retentionDuration: 14, enabled: true },
    ]);
  });

  it("cannot go back further than the retention, which is why this is not a backup", () => {
    const now = new Date("2026-10-13T00:00:00.000Z");
    expect(oldestRecoveryPoint(now, 7).toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(() => parseDrConfig({ pitRetentionDays: 366 })).toThrow(/pitRetentionDays/);
    expect(() => parseDrConfig({ pitRetentionDays: 0 })).toThrow(/pitRetentionDays/);
  });

  it("keeps replication inside the VPC and gives no public address in a private subnet", () => {
    expect(replicationTemplate(config, "subnet-0123456789abcdef0")).toMatchObject({
      stagingAreaSubnetId: "subnet-0123456789abcdef0",
      dataPlaneRouting: "PRIVATE_IP",
      createPublicIP: false,
      associateDefaultSecurityGroup: true,
      replicationServerInstanceType: "t3.small",
      ebsEncryption: "DEFAULT",
    });
    expect(
      replicationTemplate(parseDrConfig({ placement: "public" }), "subnet-0").createPublicIP,
    ).toBe(true);
  });

  it("does not copy the source's private address into another subnet", () => {
    expect(launchTemplate()).toMatchObject({ copyPrivateIp: false, launchDisposition: "STARTED" });
  });

  it("prints commands whose bodies are the requests themselves", () => {
    const [initialize, replication, launch] = setupCommands(
      config,
      "ap-northeast-1",
      "subnet-0123456789abcdef0",
    );
    expect(initialize).toBe("aws drs initialize-service --region ap-northeast-1");
    const body = (command: string | undefined) =>
      JSON.parse(/--cli-input-json '(.+)'$/.exec(command ?? "")?.[1] ?? "null") as unknown;
    expect(body(replication)).toEqual(replicationTemplate(config, "subnet-0123456789abcdef0"));
    expect(body(launch)).toEqual(launchTemplate());
  });

  it("refuses a role name or a security group ID that could not be one", () => {
    expect(() => parseDrConfig({ sourceRoleName: "role; rm -rf /" })).toThrow(/sourceRoleName/);
    expect(() => parseDrConfig({ sourceSecurityGroupId: "sg-XYZ" })).toThrow(
      /sourceSecurityGroupId/,
    );
  });
});
