import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  AmazonLinux2023ImageSsmParameter,
  AmazonLinux2023Kernel,
  AmazonLinuxCpuType,
  CfnInstance,
  CfnSecurityGroup,
  CfnSecurityGroupIngress,
  CfnVolume,
  CfnVolumeAttachment,
} from "aws-cdk-lib/aws-ec2";
import { CfnInstanceProfile, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { type FleetConfig, nodeNames } from "../../src/config.ts";
import { nodeSpec, renderUserData } from "../../src/machine.ts";

export type CelldStackProps = StackProps & { config: FleetConfig };

export class CelldStack extends Stack {
  constructor(scope: Construct, id: string, props: CelldStackProps) {
    super(scope, id, props);
    const { config } = props;
    const spec = nodeSpec();
    const named = (name: string) => [{ key: "Name", value: `${id}/${name}` }];
    const removal = config.stateOnDestroy === "retain" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // #region buckets
    const bucketDefaults = {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: removal,
      // celld uploads large objects in parts. A part of an upload that never completed is billed until removed.
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }],
    };
    // Deployments, cell state, ownership records, node leases, and the fleet's shared secret.
    const fleet = new Bucket(this, "Fleet", bucketDefaults);
    // Stopped-fleet copies. The nodes get no permission on this one.
    const backups = new Bucket(this, "Backups", bucketDefaults);
    // #endregion buckets

    // #region role
    const role = new Role(this, "NodeRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      description: "What a chapter 24 celld node may do in AWS",
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    // Whoever holds these permissions controls the fleet. One prefix of one bucket, nothing else.
    role.addToPolicy(
      new PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
        resources: [fleet.arnForObjects(`${spec.fleetPrefix}/*`)],
      }),
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [fleet.bucketArn],
        conditions: { StringLike: { "s3:prefix": [`${spec.fleetPrefix}/*`] } },
      }),
    );
    // The release archives: read, never written, by a node.
    role.addToPolicy(
      new PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [fleet.arnForObjects(`${spec.artifactPrefix}/*`)],
      }),
    );
    const profile = new CfnInstanceProfile(this, "NodeProfile", { roles: [role.roleName] });
    // #endregion role

    // #region network
    const vpc = importNetwork(this, "Network");
    const securityGroup = new CfnSecurityGroup(this, "NodeSecurityGroup", {
      groupDescription: "Chapter 24 celld nodes: peers in, HTTPS and peers out",
      vpcId: vpc.vpcId,
      securityGroupEgress: [
        { ipProtocol: "tcp", fromPort: 443, toPort: 443, cidrIp: "0.0.0.0/0", description: "HTTPS to AWS APIs" },
        {
          ipProtocol: "tcp",
          fromPort: spec.internalPort,
          toPort: spec.internalPort,
          cidrIp: vpc.vpcCidrBlock,
          description: "celld internal listener of other nodes",
        },
      ],
      tags: named("node"),
    });
    // The internal listener carries unsigned traffic and an operator API with no login.
    // Only a member of this same group may connect to it. The Worker listener gets no rule at all.
    new CfnSecurityGroupIngress(this, "PeerIngress", {
      groupId: securityGroup.attrGroupId,
      sourceSecurityGroupId: securityGroup.attrGroupId,
      ipProtocol: "tcp",
      fromPort: spec.internalPort,
      toPort: spec.internalPort,
      description: "celld peers and operator API, from this group only",
    });
    // #endregion network

    // #region nodes
    const imageId =
      config.amiId ??
      new AmazonLinux2023ImageSsmParameter({
        cpuType: AmazonLinuxCpuType.ARM_64,
        kernel: AmazonLinux2023Kernel.DEFAULT,
        cachedInContext: false,
      }).getImage(this).imageId;
    const userData = Fn.base64(renderUserData(spec));

    nodeNames(config.nodes).forEach((node, index) => {
      // Spread over the zones the network has, in order: a, b, a.
      const subnet = vpc.isolatedSubnets[index % vpc.isolatedSubnets.length];
      if (subnet === undefined) {
        throw new Error("the network has no private subnet");
      }
      const label = node.toUpperCase();
      const instance = new CfnInstance(this, `Node${label}`, {
        imageId,
        instanceType: config.instanceType,
        iamInstanceProfile: profile.ref,
        subnetId: subnet.subnetId,
        securityGroupIds: [securityGroup.attrGroupId],
        metadataOptions: { httpEndpoint: "enabled", httpTokens: "required", httpPutResponseHopLimit: 1 },
        creditSpecification: { cpuCredits: "standard" },
        userData,
        tags: named(`node-${node}`),
      });

      // The node's working directory: SQLite files, and the log of writes it holds for its peers.
      const snapshot = config.dataSnapshots[node];
      const volume = new CfnVolume(this, `Node${label}Data`, {
        availabilityZone: subnet.availabilityZone,
        size: config.dataVolumeGiB,
        ...(snapshot === undefined ? {} : { snapshotId: snapshot }),
        volumeType: "gp3",
        encrypted: true,
        tags: named(`node-${node}-data`),
      });
      volume.applyRemovalPolicy(removal);
      new CfnVolumeAttachment(this, `Node${label}DataAttachment`, {
        instanceId: instance.ref,
        volumeId: volume.ref,
        device: spec.dataDevice,
      });

      new CfnOutput(this, `Node${label}InstanceId`, { value: instance.ref });
      new CfnOutput(this, `Node${label}VolumeId`, { value: volume.ref });
    });
    // #endregion nodes

    new CfnOutput(this, "FleetBucketName", { value: fleet.bucketName });
    new CfnOutput(this, "BackupBucketName", { value: backups.bucketName });
    new CfnOutput(this, "NodeCount", { value: String(config.nodes) });
  }
}
