import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { parseHostConfig } from "../../src/host-config.ts";
import { FirecrackerHostStack } from "../lib/firecracker-host-stack.ts";

type Resource = { Type: string; Properties?: Record<string, unknown>; DeletionPolicy?: string };
type Statement = { Effect: string; Action: string | string[]; Resource: unknown };

function synth(input: unknown = {}) {
  const app = new App();
  const stack = new FirecrackerHostStack(app, "AihFirecracker", {
    env: { region: "ap-northeast-1" },
    config: parseHostConfig(input),
  });
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
  return { app, template, json, only, types };
}

const idle = synth();
const running = synth({ run: "true" });

const FREE_TYPES = [
  "AWS::EC2::LaunchTemplate",
  "AWS::EC2::SecurityGroup",
  "AWS::IAM::InstanceProfile",
  "AWS::IAM::Policy",
  "AWS::IAM::Role",
  "AWS::S3::Bucket",
  "AWS::S3::BucketPolicy",
];

describe("FirecrackerHostStack without the flag", () => {
  const { app, template, json, only, types } = idle;
  const data = (only("AWS::EC2::LaunchTemplate").Properties?.["LaunchTemplateData"] ??
    {}) as Record<string, unknown>;

  it("creates no instance, so nothing in it is billed by the hour", () => {
    template.resourceCountIs("AWS::EC2::Instance", 0);
    template.resourceCountIs("AWS::EC2::EIP", 0);
    expect(Object.keys(json.Outputs)).toEqual(["KitBucketName"]);
    expect(types).toEqual(FREE_TYPES);
  });

  it("asks for nested virtualization, which is what gives the instance /dev/kvm", () => {
    expect(data["CpuOptions"]).toEqual({ NestedVirtualization: "enabled" });
    expect(data["InstanceType"]).toBe("c7i.large");
  });

  it("takes the x86_64 image with the 6.1 kernel, looked up at deploy time", () => {
    const image = data["ImageId"] as { Ref: string };
    expect(json.Parameters[image.Ref]).toEqual({
      Type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>",
      Default: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64",
    });
  });

  it("requires IMDSv2 and keeps the token one hop from the instance", () => {
    expect(data["MetadataOptions"]).toEqual({
      HttpEndpoint: "enabled",
      HttpTokens: "required",
      HttpPutResponseHopLimit: 1,
    });
  });

  it("encrypts the root volume and deletes it with the instance", () => {
    expect(data["BlockDeviceMappings"]).toEqual([
      {
        DeviceName: "/dev/xvda",
        Ebs: { VolumeSize: 16, VolumeType: "gp3", Encrypted: true, DeleteOnTermination: true },
      },
    ]);
  });

  it("opens no inbound port and lets only HTTPS out", () => {
    const group = only("AWS::EC2::SecurityGroup").Properties ?? {};
    expect(group["SecurityGroupIngress"]).toBeUndefined();
    template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 0);
    expect(group["SecurityGroupEgress"]).toEqual([
      {
        IpProtocol: "tcp",
        FromPort: 443,
        ToPort: 443,
        CidrIp: "0.0.0.0/0",
        Description: "HTTPS to AWS APIs and to the downloads",
      },
    ]);
    expect(data["KeyName"]).toBeUndefined();
  });

  it("gives the role the SSM agent policy and one read of the kit, nothing else", () => {
    const role = only("AWS::IAM::Role").Properties ?? {};
    expect(JSON.stringify(role["ManagedPolicyArns"])).toContain("AmazonSSMManagedInstanceCore");
    expect(role["ManagedPolicyArns"]).toHaveLength(1);

    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]?.Action).toBe("s3:GetObject");
    expect(statements[0]?.Resource).toEqual({
      "Fn::Join": ["", [{ "Fn::GetAtt": [expect.stringMatching(/^Kit/), "Arn"] }, "/kit/*"]],
    });
    expect(JSON.stringify(statements)).not.toContain('"*"');
  });

  it("keeps the kit bucket private and deletes everything with the stack", () => {
    const bucket = only("AWS::S3::Bucket");
    expect(bucket.Properties?.["PublicAccessBlockConfiguration"]).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    for (const [id, resource] of Object.entries(json.Resources)) {
      expect(resource.DeletionPolicy ?? "Delete", id).toBe("Delete");
    }
  });

  it("synthesizes without asking AWS anything", () => {
    expect(app.synth().manifest.missing).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("Fn::GetAZs");
  });
});

describe("FirecrackerHostStack with `run=true`", () => {
  const { only, types, json } = running;

  it("adds one instance and nothing else", () => {
    expect(types).toEqual(["AWS::EC2::Instance", ...FREE_TYPES].toSorted());
    expect(Object.keys(json.Outputs).toSorted()).toEqual(["InstanceId", "KitBucketName"]);
  });

  it("launches it from the template, in the first public subnet, with nothing inbound", () => {
    expect(only("AWS::EC2::Instance").Properties).toEqual({
      LaunchTemplate: {
        LaunchTemplateId: { Ref: "HostTemplate" },
        Version: { "Fn::GetAtt": ["HostTemplate", "LatestVersionNumber"] },
      },
      NetworkInterfaces: [
        {
          DeviceIndex: "0",
          SubnetId: { "Fn::ImportValue": "AihNetwork-Public1SubnetId" },
          GroupSet: [{ "Fn::GetAtt": ["HostSecurityGroup", "GroupId"] }],
          AssociatePublicIpAddress: true,
        },
      ],
      Tags: [{ Key: "Name", Value: "AihFirecracker/host" }],
    });
  });
});

describe("FirecrackerHostStack against the pinned cdkd", () => {
  it("uses one instance property that cdkd 0.296.28 does not write itself", () => {
    // The handled properties of AWS::EC2::Instance in the installed cdkd 0.296.28. LaunchTemplate
    // is not among them, and AWS::EC2::LaunchTemplate has no provider: both go to Cloud Control.
    const handled = [
      "ImageId",
      "InstanceType",
      "KeyName",
      "SecurityGroupIds",
      "SecurityGroups",
      "SubnetId",
      "IamInstanceProfile",
      "UserData",
      "BlockDeviceMappings",
      "Tags",
      "AvailabilityZone",
      "NetworkInterfaces",
      "DisableApiTermination",
      "MetadataOptions",
      "Monitoring",
      "EbsOptimized",
      "CreditSpecification",
    ];
    const used = Object.keys(running.only("AWS::EC2::Instance").Properties ?? {});
    expect(used.filter((name) => !handled.includes(name))).toEqual(["LaunchTemplate"]);
  });
});

describe("host settings", () => {
  it("leaves the instance off unless told otherwise", () => {
    expect(parseHostConfig({})).toEqual({
      run: false,
      instanceType: "c7i.large",
      rootVolumeGiB: 16,
    });
    expect(parseHostConfig({ run: "false" }).run).toBe(false);
    expect(parseHostConfig({ run: true, rootVolumeGiB: "32" })).toMatchObject({
      run: true,
      rootVolumeGiB: 32,
    });
  });

  it("rejects what is not on the list", () => {
    for (const input of [
      { run: "yes" },
      // Graviton: Firecracker runs on it, but EC2 does not nest on it.
      { instanceType: "c7g.large" },
      { instanceType: "c5.metal" },
      { rootVolumeGiB: "4" },
    ]) {
      expect(() => parseHostConfig(input), JSON.stringify(input)).toThrow("Invalid host settings");
    }
  });
});
