import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { parseFleetConfig } from "../../src/config.ts";
import { nodeSpec, renderUserData } from "../../src/machine.ts";
import { CelldStack } from "../lib/celld-stack.ts";

type Resource = {
  Type: string;
  Properties?: Record<string, unknown>;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
};
type Statement = { Effect: string; Action: string | string[]; Resource: unknown; Condition?: unknown };

function synth(input: unknown = {}) {
  const app = new App();
  const config = parseFleetConfig(input);
  const stack = new CelldStack(app, "AihCelld", { env: { region: "ap-northeast-1" }, config });
  const template = Template.fromStack(stack);
  const json = template.toJSON() as {
    Resources: Record<string, Resource>;
    Outputs: Record<string, { Value: unknown }>;
  };
  const all = (type: string): [string, Resource][] =>
    Object.entries(json.Resources).filter(([, resource]) => resource.Type === type);
  const types = [...new Set(Object.values(json.Resources).map((resource) => resource.Type))].toSorted();
  return { app, template, json, all, types };
}

// Synthesized once per layout, outside the tests: the first synthesis of a file is the slow one.
const foundation = synth();
const fleet = synth({ nodes: 3 });

describe("CelldStack with no settings", () => {
  it("creates nothing that is billed by the hour", () => {
    expect(foundation.types).toEqual([
      "AWS::EC2::SecurityGroup",
      "AWS::EC2::SecurityGroupIngress",
      "AWS::IAM::InstanceProfile",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
    ]);
    expect(foundation.json.Outputs["NodeCount"]?.Value).toBe("0");
  });

  it("synthesizes without asking AWS anything", () => {
    expect(foundation.app.synth().manifest.missing).toBeUndefined();
    expect(fleet.app.synth().manifest.missing).toBeUndefined();
    expect(JSON.stringify(fleet.json)).not.toContain("Fn::GetAZs");
  });
});

describe("CelldStack with `nodes=3`", () => {
  const instances = fleet.all("AWS::EC2::Instance");
  const volumes = fleet.all("AWS::EC2::Volume");

  it("creates exactly the nodes asked for, spread over the network's two zones", () => {
    expect(instances.map(([id]) => id)).toEqual(["NodeA", "NodeB", "NodeC"]);
    expect(instances.map(([, instance]) => instance.Properties?.["SubnetId"])).toEqual([
      { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
      { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
      { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
    ]);
    expect(synth({ nodes: 1 }).all("AWS::EC2::Instance")).toHaveLength(1);
  });

  it("gives no node a public address or a key pair", () => {
    for (const [id, instance] of instances) {
      expect(instance.Properties?.["NetworkInterfaces"], id).toBeUndefined();
      expect(instance.Properties?.["KeyName"], id).toBeUndefined();
    }
    fleet.template.resourceCountIs("AWS::EC2::EIP", 0);
    fleet.template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
  });

  it("lets a node be reached on the internal port only, and only by a member of the same group", () => {
    const [[, group]] = fleet.all("AWS::EC2::SecurityGroup") as [[string, Resource]];
    expect(group.Properties?.["SecurityGroupIngress"]).toBeUndefined();
    const ingress = fleet.all("AWS::EC2::SecurityGroupIngress").map(([, rule]) => rule.Properties);
    expect(ingress).toEqual([
      {
        GroupId: { "Fn::GetAtt": ["NodeSecurityGroup", "GroupId"] },
        SourceSecurityGroupId: { "Fn::GetAtt": ["NodeSecurityGroup", "GroupId"] },
        IpProtocol: "tcp",
        FromPort: 8081,
        ToPort: 8081,
        Description: "celld peers and operator API, from this group only",
      },
    ]);
    // No rule for 8080: the Worker listener is on loopback and has no way in from the network.
    expect(JSON.stringify(fleet.json.Resources)).not.toContain('"FromPort":8080');
    expect(JSON.stringify(ingress)).not.toContain("CidrIp");
  });

  it("lets a node open HTTPS, and the internal port inside the VPC, and nothing else", () => {
    const [[, group]] = fleet.all("AWS::EC2::SecurityGroup") as [[string, Resource]];
    expect(group.Properties?.["SecurityGroupEgress"]).toEqual([
      { IpProtocol: "tcp", FromPort: 443, ToPort: 443, CidrIp: "0.0.0.0/0", Description: "HTTPS to AWS APIs" },
      {
        IpProtocol: "tcp",
        FromPort: 8081,
        ToPort: 8081,
        CidrIp: { "Fn::ImportValue": "AihNetwork-VpcCidr" },
        Description: "celld internal listener of other nodes",
      },
    ]);
  });

  it("requires IMDSv2 on every node and caps the CPU bill", () => {
    for (const [id, instance] of instances) {
      expect(instance.Properties?.["MetadataOptions"], id).toEqual({
        HttpEndpoint: "enabled",
        HttpTokens: "required",
        HttpPutResponseHopLimit: 1,
      });
      expect(instance.Properties?.["CreditSpecification"], id).toEqual({ CPUCredits: "standard" });
      expect(instance.Properties?.["InstanceType"], id).toBe("t4g.small");
    }
  });

  it("passes the same user data to every node, with nothing filled in at deploy time", () => {
    for (const [id, instance] of instances) {
      expect(instance.Properties?.["UserData"], id).toEqual({ "Fn::Base64": renderUserData(nodeSpec()) });
    }
  });

  it("puts each node's working directory on its own encrypted volume, in the node's zone", () => {
    expect(volumes.map(([id]) => id)).toEqual(["NodeAData", "NodeBData", "NodeCData"]);
    expect(volumes[1]?.[1].Properties).toEqual({
      AvailabilityZone: { "Fn::ImportValue": "AihNetwork-Az2" },
      Size: 8,
      VolumeType: "gp3",
      Encrypted: true,
      Tags: [{ Key: "Name", Value: "AihCelld/node-b-data" }],
    });
    expect(fleet.all("AWS::EC2::VolumeAttachment").map(([, attachment]) => attachment.Properties)).toEqual([
      { InstanceId: { Ref: "NodeA" }, VolumeId: { Ref: "NodeAData" }, Device: "/dev/sdf" },
      { InstanceId: { Ref: "NodeB" }, VolumeId: { Ref: "NodeBData" }, Device: "/dev/sdf" },
      { InstanceId: { Ref: "NodeC" }, VolumeId: { Ref: "NodeCData" }, Device: "/dev/sdf" },
    ]);
    for (const [id, instance] of instances) {
      expect(instance.Properties?.["BlockDeviceMappings"], id).toBeUndefined();
    }
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    expect(fleet.types).toEqual([
      "AWS::EC2::Instance",
      "AWS::EC2::SecurityGroup",
      "AWS::EC2::SecurityGroupIngress",
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
    // From the property lists in the 0.296.28 package. Volume and VolumeAttachment have
    // no provider of their own and go through Cloud Control whatever their properties.
    const handled: Record<string, string[]> = {
      "AWS::EC2::Instance": [
        "CreditSpecification",
        "IamInstanceProfile",
        "ImageId",
        "InstanceType",
        "MetadataOptions",
        "SecurityGroupIds",
        "SubnetId",
        "Tags",
        "UserData",
      ],
      "AWS::EC2::SecurityGroup": ["GroupDescription", "SecurityGroupEgress", "Tags", "VpcId"],
      "AWS::EC2::SecurityGroupIngress": [
        "Description",
        "FromPort",
        "GroupId",
        "IpProtocol",
        "SourceSecurityGroupId",
        "ToPort",
      ],
      "AWS::IAM::InstanceProfile": ["Roles"],
      "AWS::IAM::Policy": ["PolicyDocument", "PolicyName", "Roles"],
      "AWS::IAM::Role": ["AssumeRolePolicyDocument", "Description", "ManagedPolicyArns"],
      "AWS::S3::Bucket": [
        "BucketEncryption",
        "LifecycleConfiguration",
        "OwnershipControls",
        "PublicAccessBlockConfiguration",
      ],
      "AWS::S3::BucketPolicy": ["Bucket", "PolicyDocument"],
    };
    for (const [id, resource] of Object.entries(fleet.json.Resources)) {
      const allowed = handled[resource.Type];
      if (allowed !== undefined) {
        expect(allowed, id).toEqual(expect.arrayContaining(Object.keys(resource.Properties ?? {})));
      }
    }
  });
});

describe("what a node may do in AWS", () => {
  const statements = Object.values(fleet.template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
  );
  const fleetBucket = { "Fn::GetAtt": [expect.stringMatching(/^Fleet/), "Arn"] };

  it("reads, writes, and deletes under the fleet prefix of the fleet bucket", () => {
    expect(statements[0]).toEqual({
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      Resource: { "Fn::Join": ["", [fleetBucket, "/fleet/*"]] },
    });
  });

  it("lists that prefix only", () => {
    expect(statements[1]).toEqual({
      Effect: "Allow",
      Action: "s3:ListBucket",
      Resource: fleetBucket,
      Condition: { StringLike: { "s3:prefix": ["fleet/*"] } },
    });
  });

  it("reads release archives and cannot replace them", () => {
    expect(statements[2]).toEqual({
      Effect: "Allow",
      Action: "s3:GetObject",
      Resource: { "Fn::Join": ["", [fleetBucket, "/artifacts/*"]] },
    });
  });

  it("has no wildcard, and no permission at all on the backup bucket", () => {
    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect([statement.Action].flat().join(), JSON.stringify(statement)).not.toContain("*");
      expect(statement.Resource).not.toBe("*");
      expect(JSON.stringify(statement.Resource)).not.toContain("Backups");
    }
    const [[, role]] = fleet.all("AWS::IAM::Role") as [[string, Resource]];
    expect(role.Properties?.["ManagedPolicyArns"]).toEqual([
      { "Fn::Join": ["", ["arn:", { Ref: "AWS::Partition" }, ":iam::aws:policy/AmazonSSMManagedInstanceCore"]] },
    ]);
  });
});

describe("what outlives the stack", () => {
  it("keeps both buckets and every data volume by default", () => {
    const kept = [...fleet.all("AWS::S3::Bucket"), ...fleet.all("AWS::EC2::Volume")];
    expect(kept).toHaveLength(5);
    for (const [id, resource] of kept) {
      expect(resource.DeletionPolicy, id).toBe("Retain");
      expect(resource.UpdateReplacePolicy, id).toBe("Retain");
    }
  });

  it("keeps nothing else", () => {
    for (const [id, resource] of Object.entries(fleet.json.Resources)) {
      if (resource.Type !== "AWS::S3::Bucket" && resource.Type !== "AWS::EC2::Volume") {
        expect(resource.DeletionPolicy ?? "Delete", id).toBe("Delete");
      }
    }
  });

  it("deletes them with the stack only when asked: `stateOnDestroy=delete`", () => {
    const throwaway = synth({ nodes: 2, stateOnDestroy: "delete" });
    for (const [id, resource] of [...throwaway.all("AWS::S3::Bucket"), ...throwaway.all("AWS::EC2::Volume")]) {
      expect(resource.DeletionPolicy, id).toBe("Delete");
    }
  });

  it("keeps the buckets private, encrypted, and free of abandoned upload parts", () => {
    for (const [id, bucket] of fleet.all("AWS::S3::Bucket")) {
      expect(bucket.Properties?.["PublicAccessBlockConfiguration"], id).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(bucket.Properties?.["BucketEncryption"], id).toBeDefined();
      expect(bucket.Properties?.["LifecycleConfiguration"], id).toEqual({
        Rules: [{ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 }, Status: "Enabled" }],
      });
      // Versioning is left off: how celld's deletes and epoch GC behave on a versioned bucket was not read anywhere.
      expect(bucket.Properties?.["VersioningConfiguration"], id).toBeUndefined();
    }
  });
});

describe("restore and other settings", () => {
  it("starts a node's volume from a snapshot with `dataSnapshots`, one node at a time", () => {
    const restored = synth({ nodes: 2, dataSnapshots: "a:snap-0123456789abcdef0" });
    const [a, b] = restored.all("AWS::EC2::Volume");
    expect(a?.[1].Properties).toMatchObject({ SnapshotId: "snap-0123456789abcdef0", Encrypted: true });
    expect(b?.[1].Properties?.["SnapshotId"]).toBeUndefined();
  });

  it("rejects settings that are not on the list", () => {
    for (const input of [
      { nodes: 4 },
      { nodes: -1 },
      { nodes: "many" },
      { instanceType: "m7g.16xlarge" },
      { stateOnDestroy: "keep" },
      { amiId: "ami-latest" },
      { nodes: 1, dataSnapshots: "b:snap-0123456789abcdef0" },
      { nodes: 2, dataSnapshots: "a:vol-0123456789abcdef0" },
    ]) {
      expect(() => parseFleetConfig(input), JSON.stringify(input)).toThrow("Invalid fleet settings");
    }
  });
});
