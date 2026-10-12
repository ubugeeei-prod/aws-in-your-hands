import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { describe, expect, it } from "vite-plus/test";

import { parseNetworkConfig } from "../../src/config.ts";
import { planNetwork } from "../../src/plan.ts";
import { importNetwork } from "../lib/import-network.ts";
import { NetworkStack } from "../lib/network-stack.ts";

/** Every `Fn::ImportValue` name anywhere in a value. */
function importedNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(importedNames);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, inner]) =>
    key === "Fn::ImportValue" && typeof inner === "string" ? [inner] : importedNames(inner),
  );
}

describe("importNetwork", () => {
  // A stack in another CDK app, the way chapters 12, 13, and 23 will use the VPC.
  const app = new App();
  const consumer = new Stack(app, "Consumer", { env: { region: "ap-northeast-1" } });
  const vpc = importNetwork(consumer, "Network");
  new ec2.SecurityGroup(consumer, "Group", { vpc, description: "test", allowAllOutbound: false });

  // Synthesized once, outside the tests: the first synthesis of a file is the slow one.
  const producer = Template.fromStack(
    new NetworkStack(new App(), "AihNetwork", {
      env: { region: "ap-northeast-1" },
      plan: planNetwork(parseNetworkConfig({})),
    }),
  ).toJSON() as { Outputs: Record<string, { Export: { Name: string } }> };
  const consumerTemplate = Template.fromStack(consumer);

  it("imports only names that the network stack exports", () => {
    const exported = new Set(Object.values(producer.Outputs).map((output) => output.Export.Name));

    const used = importedNames(
      consumer.resolve({
        vpc: [vpc.vpcId, vpc.vpcCidrBlock, vpc.availabilityZones],
        subnets: [...vpc.publicSubnets, ...vpc.isolatedSubnets].map((subnet) => [
          subnet.subnetId,
          subnet.routeTable.routeTableId,
        ]),
      }),
    );

    expect(new Set(used).size).toBe(12);
    for (const name of used) {
      expect(exported.has(name), name).toBe(true);
    }
    expect(exported.size).toBe(12);
  });

  it("hands the private subnets over as isolated, with no NAT assumed", () => {
    expect(vpc.isolatedSubnets).toHaveLength(2);
    expect(vpc.privateSubnets).toHaveLength(0);
    expect(consumer.resolve(vpc.isolatedSubnets[0]?.subnetId)).toEqual({
      "Fn::ImportValue": "AihNetwork-Private1SubnetId",
    });
  });

  it("leaves the lookup to deploy time", () => {
    consumerTemplate.hasResourceProperties("AWS::EC2::SecurityGroup", {
      VpcId: { "Fn::ImportValue": "AihNetwork-VpcId" },
    });
    expect(app.synth().manifest.missing).toBeUndefined();
  });
});
