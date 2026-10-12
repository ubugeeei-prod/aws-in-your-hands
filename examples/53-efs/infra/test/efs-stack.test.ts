import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { parseEfsConfig } from "../../src/config.ts";
import { EfsStack, VPC_ATTACH_ACTIONS } from "../lib/efs-stack.ts";

type Resource = {
  Type: string;
  Properties?: Record<string, unknown>;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  DependsOn?: string[];
};
type Statement = {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource?: unknown;
  Principal?: unknown;
  Condition?: unknown;
};

function synth(input: unknown = {}) {
  const app = new App();
  const stack = new EfsStack(app, "AihEfs", {
    env: { region: "ap-northeast-1" },
    config: parseEfsConfig(input),
  });
  const template = Template.fromStack(stack);
  const json = template.toJSON() as { Resources: Record<string, Resource> };
  const all = (type: string): [string, Resource][] =>
    Object.entries(json.Resources).filter(([, resource]) => resource.Type === type);
  const only = (type: string): Resource => {
    const found = all(type);
    if (found.length !== 1 || found[0] === undefined) {
      throw new Error(`expected one ${type}, found ${found.length}`);
    }
    return found[0][1];
  };
  return { app, template, json, all, only };
}

// Synthesized once, outside the tests: the first synthesis bundles the function.
const practice = synth();
const FILE_SYSTEM_ARN = { "Fn::GetAtt": ["Notes", "Arn"] };
const ACCESS_POINT_ARN = { "Fn::GetAtt": ["NotesApp", "Arn"] };

describe("EfsStack", () => {
  const { app, template, json, all, only } = practice;
  const fileSystem = only("AWS::EFS::FileSystem");

  it("encrypts the file system, and bills throughput only for bytes moved", () => {
    expect(fileSystem.Properties).toMatchObject({
      Encrypted: true,
      PerformanceMode: "generalPurpose",
      ThroughputMode: "elastic",
    });
    expect(fileSystem.Properties?.["ProvisionedThroughputInMibps"]).toBeUndefined();
  });

  it("sets no lifecycle policy: small files cost more in Infrequent Access", () => {
    expect(fileSystem.Properties?.["LifecyclePolicies"]).toBeUndefined();
  });

  it("replaces the default policy, which lets any client that reaches a mount target in", () => {
    const policy = fileSystem.Properties?.["FileSystemPolicy"] as { Statement: Statement[] };
    // Nothing is allowed here, so only an IAM identity policy can let a client in.
    expect(policy.Statement.filter((statement) => statement.Effect === "Allow")).toEqual([]);
    expect(policy.Statement).toEqual([
      {
        Sid: "RefuseUnencryptedTransport",
        Effect: "Deny",
        Principal: { AWS: "*" },
        Action: "*",
        Condition: { Bool: { "aws:SecureTransport": "false" } },
      },
    ]);
  });

  it("puts one mount target in each private subnet of the chapter 11 VPC", () => {
    const targets = all("AWS::EFS::MountTarget").map(([, resource]) => resource.Properties);
    expect(targets).toEqual([
      {
        FileSystemId: { Ref: "Notes" },
        SubnetId: { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
        SecurityGroups: [{ "Fn::GetAtt": [expect.stringMatching(/^MountTargetGroup/), "GroupId"] }],
      },
      {
        FileSystemId: { Ref: "Notes" },
        SubnetId: { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
        SecurityGroups: [{ "Fn::GetAtt": [expect.stringMatching(/^MountTargetGroup/), "GroupId"] }],
      },
    ]);
  });

  it("opens NFS between the function and the mount targets, and nothing else", () => {
    const ingress = all("AWS::EC2::SecurityGroupIngress").map(
      ([, resource]) => resource.Properties,
    );
    expect(ingress).toEqual([
      {
        Description: "NFS from the function",
        IpProtocol: "tcp",
        FromPort: 2049,
        ToPort: 2049,
        GroupId: { "Fn::GetAtt": [expect.stringMatching(/^MountTargetGroup/), "GroupId"] },
        SourceSecurityGroupId: {
          "Fn::GetAtt": [expect.stringMatching(/^FunctionGroup/), "GroupId"],
        },
      },
    ]);
    const egress = all("AWS::EC2::SecurityGroupEgress").map(([, resource]) => resource.Properties);
    expect(egress).toEqual([
      {
        Description: "NFS to EFS",
        IpProtocol: "tcp",
        FromPort: 2049,
        ToPort: 2049,
        GroupId: { "Fn::GetAtt": [expect.stringMatching(/^FunctionGroup/), "GroupId"] },
        DestinationSecurityGroupId: {
          "Fn::GetAtt": [expect.stringMatching(/^MountTargetGroup/), "GroupId"],
        },
      },
    ]);
    for (const [id, group] of all("AWS::EC2::SecurityGroup")) {
      expect(group.Properties?.["SecurityGroupIngress"], id).toBeUndefined();
      // CDK's placeholder for "no egress": one rule that matches no packet.
      expect(JSON.stringify(group.Properties?.["SecurityGroupEgress"] ?? []), id).not.toContain(
        "0.0.0.0/0",
      );
    }
  });

  it("gives the access point one directory and one POSIX identity, not root", () => {
    expect(only("AWS::EFS::AccessPoint").Properties).toMatchObject({
      FileSystemId: { Ref: "Notes" },
      PosixUser: { Uid: "1001", Gid: "1001" },
      RootDirectory: {
        Path: "/notes-app",
        CreationInfo: { OwnerUid: "1001", OwnerGid: "1001", Permissions: "750" },
      },
    });
  });

  it("mounts the access point, never the file system root, under /mnt/", () => {
    const handler = only("AWS::Lambda::Function");
    expect(handler.Properties?.["FileSystemConfigs"]).toEqual([
      { Arn: ACCESS_POINT_ARN, LocalMountPath: "/mnt/notes" },
    ]);
    expect(handler.Properties?.["Environment"]).toMatchObject({
      Variables: { NOTES_DIR: "/mnt/notes" },
    });
    expect(handler.Properties?.["VpcConfig"]).toEqual({
      SubnetIds: [
        { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
        { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
      ],
      SecurityGroupIds: [{ "Fn::GetAtt": [expect.stringMatching(/^FunctionGroup/), "GroupId"] }],
    });
  });

  it("creates the function after both mount targets", () => {
    expect(only("AWS::Lambda::Function").DependsOn).toEqual(
      expect.arrayContaining(["MountTarget1", "MountTarget2"]),
    );
  });

  it("lets the role mount and write through this access point, write its own logs, and attach to the VPC", () => {
    const role = only("AWS::IAM::Role").Properties ?? {};
    expect(role["ManagedPolicyArns"]).toBeUndefined();
    const statements = all("AWS::IAM::Policy").flatMap(
      ([, policy]) =>
        ((policy.Properties ?? {})["PolicyDocument"] as { Statement: Statement[] }).Statement,
    );
    expect(statements).toEqual([
      {
        Effect: "Allow",
        Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: { "Fn::GetAtt": [expect.stringMatching(/^HandlerLogs/), "Arn"] },
      },
      {
        Effect: "Allow",
        Action: ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"],
        Resource: FILE_SYSTEM_ARN,
        Condition: { StringEquals: { "elasticfilesystem:AccessPointArn": ACCESS_POINT_ARN } },
      },
      // The one "*": the Lambda guide says these six must be allowed on all resources.
      { Effect: "Allow", Action: [...VPC_ATTACH_ACTIONS], Resource: "*" },
    ]);
    expect(JSON.stringify(statements)).not.toContain("ClientRootAccess");
  });

  it("throttles the public API as chapter 04 does", () => {
    expect(only("AWS::ApiGatewayV2::Stage").Properties?.["DefaultRouteSettings"]).toEqual({
      ThrottlingRateLimit: 10,
      ThrottlingBurstLimit: 20,
    });
  });

  it("creates nothing that is billed by the hour", () => {
    const types = new Set(Object.values(json.Resources).map((resource) => resource.Type));
    for (const hourly of [
      "AWS::EC2::NatGateway",
      "AWS::EC2::VPCEndpoint",
      "AWS::EC2::EIP",
      "AWS::EC2::Instance",
      "AWS::ElasticLoadBalancingV2::LoadBalancer",
    ]) {
      expect(types.has(hourly), hourly).toBe(false);
    }
    expect(fileSystem.Properties?.["ThroughputMode"]).not.toBe("provisioned");
  });

  it("keeps backups off for practice, and deletes everything with the stack", () => {
    expect(fileSystem.Properties?.["BackupPolicy"]).toEqual({ Status: "DISABLED" });
    expect(fileSystem.DeletionPolicy).toBe("Delete");
    for (const [id, resource] of Object.entries(json.Resources)) {
      expect(resource.DeletionPolicy ?? "Delete", id).toBe("Delete");
    }
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const types = [...new Set(Object.values(json.Resources).map((resource) => resource.Type))];
    expect(types.toSorted()).toEqual([
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      "AWS::EC2::SecurityGroup",
      "AWS::EC2::SecurityGroupEgress",
      "AWS::EC2::SecurityGroupIngress",
      "AWS::EFS::AccessPoint",
      "AWS::EFS::FileSystem",
      "AWS::EFS::MountTarget",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
    ]);
  });

  it("stays within the EFS properties the pinned cdkd writes itself", () => {
    // From the EFS provider's handledProperties in the cdkd 0.296.28 package.
    const handled: Record<string, string[]> = {
      "AWS::EFS::FileSystem": [
        "BackupPolicy",
        "Encrypted",
        "FileSystemPolicy",
        "FileSystemTags",
        "PerformanceMode",
        "ThroughputMode",
      ],
      "AWS::EFS::MountTarget": ["FileSystemId", "SecurityGroups", "SubnetId"],
      "AWS::EFS::AccessPoint": ["AccessPointTags", "FileSystemId", "PosixUser", "RootDirectory"],
    };
    for (const [type, allowed] of Object.entries(handled)) {
      for (const [id, resource] of all(type)) {
        expect(allowed, id).toEqual(expect.arrayContaining(Object.keys(resource.Properties ?? {})));
      }
    }
  });

  it("synthesizes without asking AWS anything", () => {
    expect(app.synth().manifest.missing).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("Fn::GetAZs");
    template.resourceCountIs("AWS::EFS::FileSystem", 1);
  });
});

describe("EfsStack, other settings", () => {
  it("keeps the file system and its notes with `dataOnDestroy=retain`", () => {
    const fileSystem = synth({ dataOnDestroy: "retain" }).only("AWS::EFS::FileSystem");
    expect(fileSystem.DeletionPolicy).toBe("Retain");
    expect(fileSystem.UpdateReplacePolicy).toBe("Retain");
  });

  it("turns automatic backups on with `backup=true`", () => {
    for (const value of [true, "true"]) {
      const fileSystem = synth({ backup: value }).only("AWS::EFS::FileSystem");
      expect(fileSystem.Properties?.["BackupPolicy"]).toEqual({ Status: "ENABLED" });
    }
  });

  it("rejects settings that are not on the list", () => {
    for (const input of [
      { dataOnDestroy: "snapshot" },
      { backup: "yes" },
      { allowedOrigin: "localhost:5173" },
      { allowedOrigin: "https://example.com/path" },
    ]) {
      expect(() => parseEfsConfig(input), JSON.stringify(input)).toThrow("Invalid EFS settings");
    }
  });
});
