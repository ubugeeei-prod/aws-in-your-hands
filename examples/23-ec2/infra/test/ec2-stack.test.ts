import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { parseEc2Config } from "../../src/config.ts";
import { machineFor } from "../../src/machine.ts";
import { renderUserData } from "../../src/user-data.ts";
import { Ec2Stack } from "../lib/ec2-stack.ts";

type Resource = {
  Type: string;
  Properties?: Record<string, unknown>;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
};
type Statement = { Effect: string; Action: string | string[]; Resource: unknown };

function synth(input: unknown = {}) {
  const app = new App();
  const config = parseEc2Config(input);
  const stack = new Ec2Stack(app, "AihEc2", { env: { region: "ap-northeast-1" }, config });
  const template = Template.fromStack(stack);
  const json = template.toJSON() as {
    Resources: Record<string, Resource>;
    Parameters: Record<string, { Type: string; Default?: string }>;
    Outputs: Record<string, unknown>;
  };
  const only = (type: string): Resource => {
    const found = Object.values(json.Resources).filter((resource) => resource.Type === type);
    if (found.length !== 1 || found[0] === undefined) {
      throw new Error(`expected one ${type}, found ${found.length}`);
    }
    return found[0];
  };
  const types = [
    ...new Set(Object.values(json.Resources).map((resource) => resource.Type)),
  ].toSorted();
  return { app, config, template, json, only, types };
}

// Synthesized once per layout, outside the tests: the first synthesis of a file is the slow one.
const privateLayout = synth();
const publicLayout = synth({ placement: "public" });

describe("Ec2Stack, default layout", () => {
  const { app, config, template, json, only, types } = privateLayout;
  const instance = only("AWS::EC2::Instance").Properties ?? {};

  it("opens no inbound port: not SSH, not the API", () => {
    const group = only("AWS::EC2::SecurityGroup").Properties ?? {};
    expect(group["SecurityGroupIngress"]).toBeUndefined();
    template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 0);
    expect(instance["KeyName"]).toBeUndefined();
    expect(instance["SecurityGroupIds"]).toEqual([
      { "Fn::GetAtt": ["InstanceSecurityGroup", "GroupId"] },
    ]);
  });

  it("lets the instance open HTTPS connections and nothing else", () => {
    expect(only("AWS::EC2::SecurityGroup").Properties?.["SecurityGroupEgress"]).toEqual([
      {
        IpProtocol: "tcp",
        FromPort: 443,
        ToPort: 443,
        CidrIp: "0.0.0.0/0",
        Description: "HTTPS to AWS APIs",
      },
    ]);
  });

  it("sits in the first private subnet of the chapter 11 VPC, without a public address", () => {
    expect(instance["SubnetId"]).toEqual({ "Fn::ImportValue": "AihNetwork-Private1SubnetId" });
    expect(instance["NetworkInterfaces"]).toBeUndefined();
    template.resourceCountIs("AWS::EC2::EIP", 0);
  });

  it("requires IMDSv2 and keeps the token on the instance", () => {
    expect(instance["MetadataOptions"]).toEqual({
      HttpEndpoint: "enabled",
      HttpTokens: "required",
      HttpPutResponseHopLimit: 1,
    });
  });

  it("caps the CPU bill at the hourly price", () => {
    expect(instance["CreditSpecification"]).toEqual({ CPUCredits: "standard" });
    expect(instance["InstanceType"]).toBe("t4g.micro");
  });

  it("gives the role the SSM agent policy and one read-only statement of its own", () => {
    const role = only("AWS::IAM::Role").Properties ?? {};
    expect(role["ManagedPolicyArns"]).toEqual([
      {
        "Fn::Join": [
          "",
          ["arn:", { Ref: "AWS::Partition" }, ":iam::aws:policy/AmazonSSMManagedInstanceCore"],
        ],
      },
    ]);
    expect(JSON.stringify(role["AssumeRolePolicyDocument"])).toContain("ec2.amazonaws.com");

    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]?.Action).toBe("s3:GetObject");
    // The release prefix of this stack's bucket. Not the bucket, not "*".
    expect(statements[0]?.Resource).toEqual({
      "Fn::Join": [
        "",
        [{ "Fn::GetAtt": [expect.stringMatching(/^Releases/), "Arn"] }, "/releases/*"],
      ],
    });
    expect(only("AWS::IAM::InstanceProfile").Properties?.["Roles"]).toHaveLength(1);
    expect(instance["IamInstanceProfile"]).toEqual({ Ref: "InstanceProfile" });
  });

  it("keeps the release bucket private and encrypted, and deletes it with the stack", () => {
    const bucket = only("AWS::S3::Bucket");
    expect(bucket.Properties?.["PublicAccessBlockConfiguration"]).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(bucket.Properties?.["BucketEncryption"]).toBeDefined();
    expect(bucket.DeletionPolicy).toBe("Delete");
  });

  it("looks the AMI up at deploy time, through the parameter the Amazon Linux guide names", () => {
    const image = instance["ImageId"] as { Ref: string };
    expect(json.Parameters[image.Ref]).toEqual({
      Type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>",
      Default: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64",
    });
  });

  it("passes the user data unchanged, with nothing filled in at deploy time", () => {
    // No Fn::Join, no Ref: what the tests read is exactly what the instance runs.
    expect(instance["UserData"]).toEqual({ "Fn::Base64": renderUserData(machineFor(config)) });
  });

  it("puts the data on its own encrypted volume, in the instance's zone", () => {
    const volume = only("AWS::EC2::Volume");
    expect(volume.Properties).toEqual({
      AvailabilityZone: { "Fn::ImportValue": "AihNetwork-Az1" },
      Size: 8,
      VolumeType: "gp3",
      Encrypted: true,
      Tags: [{ Key: "Name", Value: "AihEc2/data" }],
    });
    expect(only("AWS::EC2::VolumeAttachment").Properties).toEqual({
      InstanceId: { Ref: "Instance" },
      VolumeId: { Ref: "DataVolume" },
      Device: "/dev/sdf",
    });
    // Not a block device mapping of the instance: those are created and deleted with it.
    expect(instance["BlockDeviceMappings"]).toBeUndefined();
    expect(instance["Volumes"]).toBeUndefined();
  });

  it("deletes the practice volume with the stack unless told otherwise", () => {
    expect(only("AWS::EC2::Volume").DeletionPolicy).toBe("Delete");
    for (const [id, resource] of Object.entries(json.Resources)) {
      expect(resource.DeletionPolicy ?? "Delete", id).toBe("Delete");
    }
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    expect(types).toEqual([
      "AWS::EC2::Instance",
      "AWS::EC2::SecurityGroup",
      "AWS::EC2::Volume",
      "AWS::EC2::VolumeAttachment",
      "AWS::IAM::InstanceProfile",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
    ]);
  });

  it("stays within the properties the pinned cdkd writes itself", () => {
    // From src/provisioning/property-coverage.generated.ts at v0.296.28. A property outside
    // these lists would move the whole resource to Cloud Control. Volume and
    // VolumeAttachment have no provider of their own and go through Cloud Control anyway.
    const handled: Record<string, string[]> = {
      "AWS::EC2::Instance": [
        "CreditSpecification",
        "IamInstanceProfile",
        "ImageId",
        "InstanceType",
        "MetadataOptions",
        "NetworkInterfaces",
        "SecurityGroupIds",
        "SubnetId",
        "Tags",
        "UserData",
      ],
      "AWS::EC2::SecurityGroup": ["GroupDescription", "SecurityGroupEgress", "Tags", "VpcId"],
      "AWS::IAM::InstanceProfile": ["Roles"],
      "AWS::IAM::Policy": ["PolicyDocument", "PolicyName", "Roles"],
      "AWS::IAM::Role": ["AssumeRolePolicyDocument", "Description", "ManagedPolicyArns"],
      "AWS::S3::Bucket": [
        "BucketEncryption",
        "OwnershipControls",
        "PublicAccessBlockConfiguration",
      ],
      "AWS::S3::BucketPolicy": ["Bucket", "PolicyDocument"],
    };
    for (const layout of [privateLayout, publicLayout]) {
      for (const [id, resource] of Object.entries(layout.json.Resources)) {
        const allowed = handled[resource.Type];
        if (allowed !== undefined) {
          expect(allowed, id).toEqual(
            expect.arrayContaining(Object.keys(resource.Properties ?? {})),
          );
        }
      }
    }
  });

  it("synthesizes without asking AWS anything", () => {
    expect(app.synth().manifest.missing).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("Fn::GetAZs");
  });
});

describe("Ec2Stack, other layouts", () => {
  it("asks for a public address in the first public subnet with `placement=public`, still with nothing inbound", () => {
    const { only, template } = publicLayout;
    const instance = only("AWS::EC2::Instance").Properties ?? {};
    expect(instance["NetworkInterfaces"]).toEqual([
      {
        DeviceIndex: "0",
        SubnetId: { "Fn::ImportValue": "AihNetwork-Public1SubnetId" },
        GroupSet: [{ "Fn::GetAtt": ["InstanceSecurityGroup", "GroupId"] }],
        AssociatePublicIpAddress: true,
      },
    ]);
    // RunInstances rejects a subnet or groups given both ways.
    expect(instance["SubnetId"]).toBeUndefined();
    expect(instance["SecurityGroupIds"]).toBeUndefined();
    expect(only("AWS::EC2::SecurityGroup").Properties?.["SecurityGroupIngress"]).toBeUndefined();
    // An auto-assigned address, released on stop. Not an Elastic IP address, which would be billed while stopped.
    template.resourceCountIs("AWS::EC2::EIP", 0);
  });

  it.each([
    ["snapshot", "Snapshot"],
    ["retain", "Retain"],
  ])("keeps the data when the stack is destroyed with `dataOnDestroy=%s`", (setting, policy) => {
    const volume = synth({ dataOnDestroy: setting }).only("AWS::EC2::Volume");
    expect(volume.DeletionPolicy).toBe(policy);
    expect(volume.UpdateReplacePolicy).toBe(policy);
  });

  it("starts the data volume from a snapshot with `dataSnapshotId`", () => {
    const volume = synth({ dataSnapshotId: "snap-0123456789abcdef0" }).only("AWS::EC2::Volume");
    expect(volume.Properties).toMatchObject({
      SnapshotId: "snap-0123456789abcdef0",
      Size: 8,
      Encrypted: true,
    });
    expect(privateLayout.only("AWS::EC2::Volume").Properties?.["SnapshotId"]).toBeUndefined();
  });

  it("launches a pinned image with `amiId`, without the parameter", () => {
    const { only, json } = synth({ amiId: "ami-0123456789abcdef0" });
    expect(only("AWS::EC2::Instance").Properties?.["ImageId"]).toBe("ami-0123456789abcdef0");
    expect(
      Object.values(json.Parameters).filter((parameter) => parameter.Type.includes("Image")),
    ).toEqual([]);
  });

  it("rejects settings that are not on the list", () => {
    for (const input of [
      { placement: "dmz" },
      { instanceType: "m7g.16xlarge" },
      { dataVolumeGiB: "0" },
      { amiId: "ami-latest" },
      { dataSnapshotId: "vol-0123456789abcdef0" },
      { dataOnDestroy: "keep" },
    ]) {
      expect(() => parseEc2Config(input), JSON.stringify(input)).toThrow("Invalid EC2 settings");
    }
  });
});
