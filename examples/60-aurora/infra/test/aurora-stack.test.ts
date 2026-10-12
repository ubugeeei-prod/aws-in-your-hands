import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { parseAuroraConfig } from "../../src/config.ts";
import { AuroraStack } from "../lib/aurora-stack.ts";

const synth = (context: Record<string, unknown> = {}) =>
  Template.fromStack(
    new AuroraStack(new App(), "AihAurora", {
      env: { region: "ap-northeast-1" },
      config: parseAuroraConfig(context),
    }),
  );
const template = synth();

describe("AuroraStack", () => {
  it("scales to zero, is capped at 1 ACU, and bills I/O per request by default", () => {
    template.hasResourceProperties("AWS::RDS::DBCluster", {
      Engine: "aurora-postgresql",
      EngineVersion: "17.9",
      ServerlessV2ScalingConfiguration: {
        MinCapacity: 0,
        MaxCapacity: 1,
        SecondsUntilAutoPause: 300,
      },
      StorageType: Match.absent(),
    });
  });

  it("keeps the password out of the template and the data encrypted", () => {
    template.hasResourceProperties("AWS::RDS::DBCluster", {
      ManageMasterUserPassword: true,
      MasterUserPassword: Match.absent(),
      StorageEncrypted: true,
      EnableHttpEndpoint: true,
    });
  });

  it("places one serverless instance in the private subnets of chapter 11, with no public address", () => {
    template.resourceCountIs("AWS::RDS::DBInstance", 1);
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.serverless",
      DBClusterIdentifier: { Ref: "Cluster" },
      PubliclyAccessible: false,
    });
    template.hasResourceProperties("AWS::RDS::DBSubnetGroup", {
      SubnetIds: [
        { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
        { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
      ],
    });
  });

  it("lets nothing into the cluster's security group, and nothing out", () => {
    template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      SecurityGroupIngress: Match.absent(),
      // The rule CDK writes to mean "no egress": ICMP to an address nothing has.
      SecurityGroupEgress: [Match.objectLike({ CidrIp: "255.255.255.255/32", IpProtocol: "icmp" })],
    });
    template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 0);
  });

  it("deletes the practice cluster with the stack, without a final snapshot", () => {
    template.hasResource("AWS::RDS::DBCluster", {
      Properties: { DeletionProtection: false, BackupRetentionPeriod: 1 },
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
    template.hasResource("AWS::RDS::DBInstance", { DeletionPolicy: "Delete" });
  });

  it("leaves out the auto-pause delay when the minimum is above zero", () => {
    synth({ minCapacity: "0.5", maxCapacity: "4" }).hasResourceProperties("AWS::RDS::DBCluster", {
      ServerlessV2ScalingConfiguration: {
        MinCapacity: 0.5,
        MaxCapacity: 4,
        SecondsUntilAutoPause: Match.absent(),
      },
    });
  });

  it("switches the storage configuration by context", () => {
    synth({ storage: "aurora-iopt1" }).hasResourceProperties("AWS::RDS::DBCluster", {
      StorageType: "aurora-iopt1",
    });
  });

  it("refuses capacity settings the service would refuse", () => {
    expect(() => parseAuroraConfig({ minCapacity: "0.3" })).toThrow(/minCapacity/);
    expect(() => parseAuroraConfig({ maxCapacity: "0.5" })).toThrow(/maxCapacity/);
    expect(() => parseAuroraConfig({ minCapacity: "2", maxCapacity: "1" })).toThrow(/above/);
    expect(() => parseAuroraConfig({ secondsUntilAutoPause: "60" })).toThrow(
      /secondsUntilAutoPause/,
    );
    expect(() => parseAuroraConfig({ storage: "gp3" })).toThrow(/storage/);
  });

  it("hands the Data API's two ARNs and the endpoints to the scripts", () => {
    const outputs = template.toJSON()["Outputs"] as Record<string, { Value: unknown }>;
    expect(Object.keys(outputs).toSorted()).toEqual([
      "ClusterArn",
      "ClusterEndpoint",
      "ClusterSecurityGroupId",
      "ReaderEndpoint",
      "SecretArn",
    ]);
    expect(outputs["SecretArn"]?.Value).toEqual({
      "Fn::GetAtt": ["Cluster", "MasterUserSecret.SecretArn"],
    });
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::EC2::SecurityGroup",
      // cdkd 0.296.28 has an SDK provider for these three. The cluster declares
      // EnableHttpEndpoint, which that provider does not send, so cdkd routes
      // the cluster through Cloud Control API instead.
      "AWS::RDS::DBCluster",
      "AWS::RDS::DBInstance",
      "AWS::RDS::DBSubnetGroup",
    ]);
  });
});
