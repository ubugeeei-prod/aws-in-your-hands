import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";
import { CfnOutput, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  AmazonLinux2023ImageSsmParameter,
  AmazonLinux2023Kernel,
  AmazonLinuxCpuType,
  CfnInstance,
  CfnSecurityGroup,
  CfnVolume,
  CfnVolumeAttachment,
} from "aws-cdk-lib/aws-ec2";
import { CfnInstanceProfile, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import type { Ec2Config } from "../../src/config.ts";
import { machineFor } from "../../src/machine.ts";
import { RELEASE_PREFIX } from "../../src/release.ts";
import { renderUserData } from "../../src/user-data.ts";

export type Ec2StackProps = StackProps & { config: Ec2Config };

const REMOVAL = {
  delete: RemovalPolicy.DESTROY,
  snapshot: RemovalPolicy.SNAPSHOT,
  retain: RemovalPolicy.RETAIN,
} as const;

export class Ec2Stack extends Stack {
  constructor(scope: Construct, id: string, props: Ec2StackProps) {
    super(scope, id, props);
    const { config } = props;
    const machine = machineFor(config);
    const named = (name: string) => [{ key: "Name", value: `${id}/${name}` }];

    // #region network
    // The chapter 11 VPC, read by export name. One instance, so one subnet and one zone.
    const vpc = importNetwork(this, "Network");
    const subnet = config.placement === "public" ? vpc.publicSubnets[0] : vpc.isolatedSubnets[0];
    if (subnet === undefined) {
      throw new Error(`the network has no ${config.placement} subnet`);
    }

    // No inbound rule at all: SSM Agent opens every connection from the inside.
    const securityGroup = new CfnSecurityGroup(this, "InstanceSecurityGroup", {
      groupDescription: "Chapter 23 instance: nothing in, HTTPS out",
      vpcId: vpc.vpcId,
      // Listing one egress rule replaces the allow-everything rule a new group starts with.
      securityGroupEgress: [
        { ipProtocol: "tcp", fromPort: 443, toPort: 443, cidrIp: "0.0.0.0/0", description: "HTTPS to AWS APIs" },
      ],
      tags: named("instance"),
    });
    // #endregion network

    // #region releases
    // Build output only. The notes themselves never leave the data volume.
    const releases = new Bucket(this, "Releases", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion releases

    // #region role
    const role = new Role(this, "InstanceRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      description: "What the chapter 23 instance may do in AWS",
      // What SSM Agent needs to register, take commands, and open sessions.
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    // Read releases, and nothing else in S3: no listing, no writing, no other bucket.
    role.addToPolicy(
      new PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [releases.arnForObjects(`${RELEASE_PREFIX}*`)],
      }),
    );
    // EC2 does not take a role directly. It takes an instance profile, a wrapper around exactly one role.
    const profile = new CfnInstanceProfile(this, "InstanceProfile", { roles: [role.roleName] });
    // #endregion role

    // #region ami
    // A CloudFormation parameter of an SSM type: the lookup happens at deploy time, not during synth.
    const imageId =
      config.amiId ??
      // Not MachineImage.latestAmazonLinux2023(): in this CDK version it always asks for the 6.1 kernel's image.
      new AmazonLinux2023ImageSsmParameter({
        cpuType: AmazonLinuxCpuType.ARM_64,
        kernel: AmazonLinux2023Kernel.DEFAULT,
        // Left to its default, this class looks the AMI up during synth and wants an account for it.
        cachedInContext: false,
      }).getImage(this).imageId;
    // #endregion ami

    // #region instance
    const instance = new CfnInstance(this, "Instance", {
      imageId,
      instanceType: config.instanceType,
      iamInstanceProfile: profile.ref,
      // A public address has to be asked for on the network interface; the subnet does not hand one out.
      ...(config.placement === "public"
        ? {
            networkInterfaces: [
              {
                deviceIndex: "0",
                subnetId: subnet.subnetId,
                groupSet: [securityGroup.attrGroupId],
                associatePublicIpAddress: true,
              },
            ],
          }
        : { subnetId: subnet.subnetId, securityGroupIds: [securityGroup.attrGroupId] }),
      metadataOptions: {
        httpEndpoint: "enabled",
        // IMDSv2 only: a request without a session token gets no credentials.
        httpTokens: "required",
        // The token reply may travel one hop: to the instance itself, not to a container or a proxy behind it.
        httpPutResponseHopLimit: 1,
      },
      // T4g starts in "unlimited", where sustained load is billed per vCPU-hour on top of the hourly price.
      creditSpecification: { cpuCredits: "standard" },
      userData: Fn.base64(renderUserData(machine)),
      tags: named("instance"),
    });
    // #endregion instance

    // #region data-volume
    // Its own resource, not part of the instance: replacing the instance leaves it alone.
    const dataVolume = new CfnVolume(this, "DataVolume", {
      // A volume attaches only to an instance in the same zone.
      availabilityZone: subnet.availabilityZone,
      size: config.dataVolumeGiB,
      // From a snapshot, the volume arrives with its file system and its notes.
      ...(config.dataSnapshotId === undefined ? {} : { snapshotId: config.dataSnapshotId }),
      volumeType: "gp3",
      encrypted: true,
      tags: named("data"),
    });
    dataVolume.applyRemovalPolicy(REMOVAL[config.dataOnDestroy]);

    new CfnVolumeAttachment(this, "DataVolumeAttachment", {
      instanceId: instance.ref,
      volumeId: dataVolume.ref,
      device: machine.dataDevice,
    });
    // #endregion data-volume

    new CfnOutput(this, "InstanceId", { value: instance.ref });
    new CfnOutput(this, "DataVolumeId", { value: dataVolume.ref });
    new CfnOutput(this, "ReleaseBucketName", { value: releases.bucketName });
    new CfnOutput(this, "AvailabilityZone", { value: subnet.availabilityZone });
  }
}
