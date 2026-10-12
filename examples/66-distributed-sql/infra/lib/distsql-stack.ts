import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";

import type { ClusterConfig } from "../../src/config.ts";
import { NODE, renderUserData } from "../../src/machine.ts";
import { NODE_NAMES } from "../../src/topology.ts";
import { DOCUMENTED } from "../../src/yugabyte.ts";

export type DistSqlStackProps = StackProps & { config: ClusterConfig };

/** One zone per node. The chapter 11 network must have been deployed with three. */
export const ZONES = 3;

export class DistSqlStack extends Stack {
  constructor(scope: Construct, id: string, props: DistSqlStackProps) {
    super(scope, id, props);
    const { config } = props;
    const named = (name: string) => [{ key: "Name", value: `${id}/${name}` }];
    const removal =
      config.stateOnDestroy === "retain" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const { masterRpc, tserverRpc, ysql } = DOCUMENTED.ports;

    // #region bucket
    // The release archive the nodes install from, and the backups they write.
    const bucket = new s3.Bucket(this, "Cluster", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: removal,
      // A part of an upload that never completed is billed until removed.
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }],
    });
    // #endregion bucket

    // #region role
    const role = new iam.Role(this, "NodeRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "What a chapter 66 database node may do in AWS",
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    // The release archive: read, never written, by a node.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [bucket.arnForObjects(`${NODE.artifactPrefix}/*`)],
      }),
    );
    // Backups: written and read back under one prefix. No delete: a node cannot remove what it wrote.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"],
        resources: [bucket.arnForObjects(`${NODE.backupPrefix}/*`)],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [bucket.bucketArn],
        conditions: { StringLike: { "s3:prefix": [`${NODE.backupPrefix}/*`] } },
      }),
    );
    const profile = new iam.CfnInstanceProfile(this, "NodeProfile", { roles: [role.roleName] });
    // #endregion role

    // #region network
    const vpc = importNetwork(this, "Network", ZONES);
    // An application joins this group to reach the database. It holds no rule of its own to be reached.
    const clients = new ec2.CfnSecurityGroup(this, "ClientSecurityGroup", {
      groupDescription: "Chapter 66: members may open SQL connections to the database nodes",
      vpcId: vpc.vpcId,
      securityGroupEgress: [
        {
          ipProtocol: "tcp",
          fromPort: ysql,
          toPort: ysql,
          cidrIp: vpc.vpcCidrBlock,
          description: "SQL to the database nodes",
        },
      ],
      tags: named("client"),
    });
    const nodes = new ec2.CfnSecurityGroup(this, "NodeSecurityGroup", {
      groupDescription: "Chapter 66 database nodes: peers and SQL clients in, HTTPS and peers out",
      vpcId: vpc.vpcId,
      securityGroupEgress: [
        {
          ipProtocol: "tcp",
          fromPort: 443,
          toPort: 443,
          cidrIp: "0.0.0.0/0",
          description: "HTTPS to AWS APIs",
        },
        {
          ipProtocol: "tcp",
          fromPort: masterRpc,
          toPort: masterRpc,
          cidrIp: vpc.vpcCidrBlock,
          description: "yb-master RPC of other nodes",
        },
        {
          ipProtocol: "tcp",
          fromPort: tserverRpc,
          toPort: tserverRpc,
          cidrIp: vpc.vpcCidrBlock,
          description: "yb-tserver RPC of other nodes",
        },
      ],
      tags: named("node"),
    });
    // The two RPC ports carry replication and the administrative API. Only a node may connect to them.
    // The web interfaces (7000, 9000, 13000) get no rule at all: they have no login and no TLS.
    for (const [name, port] of [
      ["Master", masterRpc],
      ["Tserver", tserverRpc],
    ] as const) {
      new ec2.CfnSecurityGroupIngress(this, `${name}PeerIngress`, {
        groupId: nodes.attrGroupId,
        sourceSecurityGroupId: nodes.attrGroupId,
        ipProtocol: "tcp",
        fromPort: port,
        toPort: port,
        description: `yb-${name.toLowerCase()} RPC, from this group only`,
      });
    }
    new ec2.CfnSecurityGroupIngress(this, "SqlIngress", {
      groupId: nodes.attrGroupId,
      sourceSecurityGroupId: clients.attrGroupId,
      ipProtocol: "tcp",
      fromPort: ysql,
      toPort: ysql,
      description: "SQL, from members of the client group only",
    });
    // #endregion network

    // #region nodes
    const imageId =
      config.amiId ??
      new ec2.AmazonLinux2023ImageSsmParameter({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
        kernel: ec2.AmazonLinux2023Kernel.DEFAULT,
        cachedInContext: false,
      }).getImage(this).imageId;
    const userData = Fn.base64(renderUserData());

    NODE_NAMES.slice(0, config.nodes).forEach((node, index) => {
      // One node per zone: losing a zone is then losing one node, which the cluster survives.
      const subnet = vpc.isolatedSubnets[index];
      if (subnet === undefined) {
        throw new Error(`the network has no private subnet in a zone number ${index + 1}`);
      }
      const label = node.toUpperCase();
      const instance = new ec2.CfnInstance(this, `Node${label}`, {
        imageId,
        instanceType: config.instanceType,
        iamInstanceProfile: profile.ref,
        subnetId: subnet.subnetId,
        securityGroupIds: [nodes.attrGroupId],
        metadataOptions: {
          httpEndpoint: "enabled",
          httpTokens: "required",
          httpPutResponseHopLimit: 1,
        },
        // Burstable types only. "standard" stops at the baseline instead of billing for more CPU.
        ...(config.instanceType.startsWith("t4g.")
          ? { creditSpecification: { cpuCredits: "standard" } }
          : {}),
        userData,
        tags: named(`node-${node}`),
      });

      // One copy of every tablet, and one copy of the catalog.
      const volume = new ec2.CfnVolume(this, `Node${label}Data`, {
        availabilityZone: subnet.availabilityZone,
        size: config.dataVolumeGiB,
        volumeType: "gp3",
        encrypted: true,
        tags: named(`node-${node}-data`),
      });
      volume.applyRemovalPolicy(removal);
      new ec2.CfnVolumeAttachment(this, `Node${label}DataAttachment`, {
        instanceId: instance.ref,
        volumeId: volume.ref,
        device: NODE.dataDevice,
      });

      new CfnOutput(this, `Node${label}InstanceId`, { value: instance.ref });
      new CfnOutput(this, `Node${label}VolumeId`, { value: volume.ref });
    });
    // #endregion nodes

    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
    new CfnOutput(this, "ClientSecurityGroupId", { value: clients.attrGroupId });
    new CfnOutput(this, "NodeCount", { value: String(config.nodes) });
  }
}
