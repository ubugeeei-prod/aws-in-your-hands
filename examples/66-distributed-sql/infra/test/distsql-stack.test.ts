import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { parseClusterConfig } from "../../src/config.ts";
import { renderUserData } from "../../src/machine.ts";
import { DistSqlStack } from "../lib/distsql-stack.ts";

type Resource = {
  Type: string;
  Properties?: Record<string, unknown>;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
};
type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
};

function synth(input: unknown = {}) {
  const app = new App();
  const config = parseClusterConfig(input);
  const stack = new DistSqlStack(app, "AihDistSql", { env: { region: "ap-northeast-1" }, config });
  const template = Template.fromStack(stack);
  const json = template.toJSON() as {
    Resources: Record<string, Resource>;
    Outputs: Record<string, { Value: unknown }>;
  };
  const all = (type: string): [string, Resource][] =>
    Object.entries(json.Resources).filter(([, resource]) => resource.Type === type);
  const types = [
    ...new Set(Object.values(json.Resources).map((resource) => resource.Type)),
  ].toSorted();
  return { app, template, json, all, types };
}

// Synthesized once per layout, outside the tests: the first synthesis of a file is the slow one.
const foundation = synth();
const cluster = synth({ nodes: 3 });

describe("DistSqlStack with no settings", () => {
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
    expect(cluster.app.synth().manifest.missing).toBeUndefined();
    expect(JSON.stringify(cluster.json)).not.toContain("Fn::GetAZs");
  });

  it("is a cluster of three or no cluster at all", () => {
    for (const nodes of [1, 2, 4, 5]) {
      expect(() => parseClusterConfig({ nodes }), String(nodes)).toThrow(
        /Invalid cluster settings/,
      );
    }
    expect(parseClusterConfig({ nodes: "3" }).nodes).toBe(3);
  });
});

describe("DistSqlStack with `nodes=3`", () => {
  const instances = cluster.all("AWS::EC2::Instance");
  const volumes = cluster.all("AWS::EC2::Volume");

  it("puts each node in a different zone of the network", () => {
    expect(instances.map(([id]) => id)).toEqual(["NodeA", "NodeB", "NodeC"]);
    expect(instances.map(([, instance]) => instance.Properties?.["SubnetId"])).toEqual([
      { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
      { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
      { "Fn::ImportValue": "AihNetwork-Private3SubnetId" },
    ]);
    expect(volumes.map(([, volume]) => volume.Properties?.["AvailabilityZone"])).toEqual([
      { "Fn::ImportValue": "AihNetwork-Az1" },
      { "Fn::ImportValue": "AihNetwork-Az2" },
      { "Fn::ImportValue": "AihNetwork-Az3" },
    ]);
  });

  it("gives no node a public address, a key pair, or a load balancer", () => {
    for (const [id, instance] of instances) {
      expect(instance.Properties?.["NetworkInterfaces"], id).toBeUndefined();
      expect(instance.Properties?.["KeyName"], id).toBeUndefined();
    }
    cluster.template.resourceCountIs("AWS::EC2::EIP", 0);
    cluster.template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
  });

  it("opens the replication ports to nodes only, SQL to the client group only, and the web interfaces to nobody", () => {
    const ingress = cluster
      .all("AWS::EC2::SecurityGroupIngress")
      .map(([, rule]) => rule.Properties);
    const nodes = { "Fn::GetAtt": ["NodeSecurityGroup", "GroupId"] };
    expect(ingress).toEqual([
      {
        GroupId: nodes,
        SourceSecurityGroupId: nodes,
        IpProtocol: "tcp",
        FromPort: 7100,
        ToPort: 7100,
        Description: "yb-master RPC, from this group only",
      },
      {
        GroupId: nodes,
        SourceSecurityGroupId: nodes,
        IpProtocol: "tcp",
        FromPort: 9100,
        ToPort: 9100,
        Description: "yb-tserver RPC, from this group only",
      },
      {
        GroupId: nodes,
        SourceSecurityGroupId: { "Fn::GetAtt": ["ClientSecurityGroup", "GroupId"] },
        IpProtocol: "tcp",
        FromPort: 5433,
        ToPort: 5433,
        Description: "SQL, from members of the client group only",
      },
    ]);
    const text = JSON.stringify(cluster.json.Resources);
    for (const port of [7000, 9000, 13000]) {
      expect(text, String(port)).not.toContain(`"FromPort":${port}`);
    }
    expect(JSON.stringify(ingress)).not.toContain("CidrIp");
    for (const [id, group] of cluster.all("AWS::EC2::SecurityGroup")) {
      expect(group.Properties?.["SecurityGroupIngress"], id).toBeUndefined();
    }
  });

  it("lets a node open HTTPS and the two RPC ports inside the VPC, and nothing else", () => {
    const group = cluster.json.Resources["NodeSecurityGroup"];
    const egress = group?.Properties?.["SecurityGroupEgress"] as Record<string, unknown>[];
    expect(egress.map((rule) => [rule["FromPort"], rule["CidrIp"]])).toEqual([
      [443, "0.0.0.0/0"],
      [7100, { "Fn::ImportValue": "AihNetwork-VpcCidr" }],
      [9100, { "Fn::ImportValue": "AihNetwork-VpcCidr" }],
    ]);
  });

  it("requires IMDSv2 on every node and caps the CPU bill of a burstable type", () => {
    for (const [id, instance] of instances) {
      expect(instance.Properties?.["MetadataOptions"], id).toEqual({
        HttpEndpoint: "enabled",
        HttpTokens: "required",
        HttpPutResponseHopLimit: 1,
      });
      expect(instance.Properties?.["CreditSpecification"], id).toEqual({ CPUCredits: "standard" });
      expect(instance.Properties?.["InstanceType"], id).toBe("t4g.medium");
    }
    // A type that is not burstable has no credit setting to give.
    for (const [id, instance] of synth({ nodes: 3, instanceType: "m7g.large" }).all(
      "AWS::EC2::Instance",
    )) {
      expect(instance.Properties?.["CreditSpecification"], id).toBeUndefined();
    }
  });

  it("passes the same user data to every node, with nothing filled in at deploy time", () => {
    for (const [id, instance] of instances) {
      expect(instance.Properties?.["UserData"], id).toEqual({ "Fn::Base64": renderUserData() });
    }
  });

  it("keeps each node's copy of the data on its own encrypted volume, which outlives the stack", () => {
    expect(volumes.map(([id]) => id)).toEqual(["NodeAData", "NodeBData", "NodeCData"]);
    expect(volumes[1]?.[1].Properties).toEqual({
      AvailabilityZone: { "Fn::ImportValue": "AihNetwork-Az2" },
      Size: 20,
      VolumeType: "gp3",
      Encrypted: true,
      Tags: [{ Key: "Name", Value: "AihDistSql/node-b-data" }],
    });
    for (const [id, volume] of volumes) {
      expect(volume.DeletionPolicy, id).toBe("Retain");
      expect(volume.UpdateReplacePolicy, id).toBe("Retain");
    }
    for (const [id, instance] of instances) {
      expect(instance.Properties?.["BlockDeviceMappings"], id).toBeUndefined();
    }
  });

  it("deletes the volumes and the bucket with the stack only when asked", () => {
    const disposable = synth({ nodes: 3, stateOnDestroy: "delete" });
    for (const [id, resource] of [
      ...disposable.all("AWS::EC2::Volume"),
      ...disposable.all("AWS::S3::Bucket"),
    ]) {
      expect(resource.DeletionPolicy, id).toBe("Delete");
    }
    for (const [id, bucket] of cluster.all("AWS::S3::Bucket")) {
      expect(bucket.DeletionPolicy, id).toBe("Retain");
    }
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    // The same ten types as chapter 24, whose notes record how cdkd 0.296.28 handles each.
    expect(cluster.types).toEqual([
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

  it("stays within the properties chapter 24 found the pinned cdkd to write itself", () => {
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
    for (const [id, resource] of Object.entries(cluster.json.Resources)) {
      const allowed = handled[resource.Type];
      if (allowed !== undefined) {
        expect(allowed, id).toEqual(expect.arrayContaining(Object.keys(resource.Properties ?? {})));
      }
    }
  });
});

describe("what a node may do in AWS", () => {
  const statements = Object.values(cluster.template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
  );
  const bucket = { "Fn::GetAtt": [expect.stringMatching(/^Cluster/), "Arn"] };

  it("reads the release archive and cannot replace it", () => {
    expect(statements[0]).toEqual({
      Effect: "Allow",
      Action: "s3:GetObject",
      Resource: { "Fn::Join": ["", [bucket, "/artifacts/*"]] },
    });
  });

  it("writes and reads backups under one prefix, and cannot delete them", () => {
    expect(statements[1]).toEqual({
      Effect: "Allow",
      Action: ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"],
      Resource: { "Fn::Join": ["", [bucket, "/backups/*"]] },
    });
    expect(statements[2]).toEqual({
      Effect: "Allow",
      Action: "s3:ListBucket",
      Resource: bucket,
      Condition: { StringLike: { "s3:prefix": ["backups/*"] } },
    });
    expect(JSON.stringify(statements)).not.toContain("Delete");
  });

  it("has no wildcard action, and no statement beyond those three", () => {
    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect([statement.Action].flat().join(), JSON.stringify(statement)).not.toContain("*");
      expect(statement.Resource).not.toBe("*");
    }
  });

  it("is reached through Systems Manager and assumed by EC2 only", () => {
    const [[, role]] = cluster.all("AWS::IAM::Role") as [[string, Resource]];
    expect(JSON.stringify(role.Properties?.["ManagedPolicyArns"])).toContain(
      "AmazonSSMManagedInstanceCore",
    );
    expect(JSON.stringify(role.Properties?.["AssumeRolePolicyDocument"])).toContain(
      "ec2.amazonaws.com",
    );
  });
});

describe("the bucket", () => {
  it("is private, encrypted, and refuses plain HTTP", () => {
    const [[, bucket]] = cluster.all("AWS::S3::Bucket") as [[string, Resource]];
    expect(bucket.Properties?.["PublicAccessBlockConfiguration"]).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(JSON.stringify(cluster.all("AWS::S3::BucketPolicy"))).toContain("aws:SecureTransport");
  });
});
