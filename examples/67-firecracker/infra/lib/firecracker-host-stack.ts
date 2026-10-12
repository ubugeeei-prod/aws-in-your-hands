import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";

import { type HostConfig, KIT_PREFIX } from "../../src/host-config.ts";

export type FirecrackerHostStackProps = StackProps & { config: HostConfig };

export class FirecrackerHostStack extends Stack {
  constructor(scope: Construct, id: string, props: FirecrackerHostStackProps) {
    super(scope, id, props);
    const { config } = props;
    const named = (name: string) => [{ key: "Name", value: `${id}/${name}` }];

    // #region network
    // A public subnet of the chapter 11 VPC: the host downloads from GitHub, S3 and nodejs.org.
    const vpc = importNetwork(this, "Network");
    const subnet = vpc.publicSubnets[0];
    if (subnet === undefined) {
      throw new Error("the network has no public subnet");
    }
    // Nothing in. The reader enters through Session Manager, as in chapter 23.
    const securityGroup = new ec2.CfnSecurityGroup(this, "HostSecurityGroup", {
      groupDescription: "Chapter 67 host: nothing in, HTTPS out",
      vpcId: vpc.vpcId,
      securityGroupEgress: [
        {
          ipProtocol: "tcp",
          fromPort: 443,
          toPort: 443,
          cidrIp: "0.0.0.0/0",
          description: "HTTPS to AWS APIs and to the downloads",
        },
      ],
      tags: named("host"),
    });
    // #endregion network

    // #region kit
    // The bundled programs of this example, for a host that has no checkout.
    const kit = new s3.Bucket(this, "Kit", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const role = new iam.Role(this, "HostRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "What the chapter 67 host may do in AWS",
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [kit.arnForObjects(`${KIT_PREFIX}*`)],
      }),
    );
    const profile = new iam.CfnInstanceProfile(this, "HostProfile", { roles: [role.roleName] });
    // #endregion kit

    // #region launch-template
    // x86_64 and the 6.1 kernel: a host kernel Firecracker 1.17 supports, on a CPU EC2 nests on.
    const imageId = new ec2.AmazonLinux2023ImageSsmParameter({
      cpuType: ec2.AmazonLinuxCpuType.X86_64,
      kernel: ec2.AmazonLinux2023Kernel.KERNEL_6_1,
      cachedInContext: false,
    }).getImage(this).imageId;

    const template = new ec2.CfnLaunchTemplate(this, "HostTemplate", {
      launchTemplateData: {
        imageId,
        instanceType: config.instanceType,
        iamInstanceProfile: { arn: profile.attrArn },
        // What makes /dev/kvm appear inside an instance that is itself a virtual machine.
        cpuOptions: { nestedVirtualization: "enabled" },
        metadataOptions: {
          httpEndpoint: "enabled",
          httpTokens: "required",
          // One hop: the instance itself. A guest behind the TAP device is a second hop.
          httpPutResponseHopLimit: 1,
        },
        blockDeviceMappings: [
          {
            deviceName: "/dev/xvda",
            ebs: {
              volumeSize: config.rootVolumeGiB,
              volumeType: "gp3",
              encrypted: true,
              deleteOnTermination: true,
            },
          },
        ],
      },
    });
    // #endregion launch-template

    // #region instance
    if (config.run) {
      const host = new ec2.CfnInstance(this, "Host", {
        launchTemplate: {
          launchTemplateId: template.ref,
          version: template.attrLatestVersionNumber,
        },
        networkInterfaces: [
          {
            deviceIndex: "0",
            subnetId: subnet.subnetId,
            groupSet: [securityGroup.attrGroupId],
            associatePublicIpAddress: true,
          },
        ],
        tags: named("host"),
      });
      new CfnOutput(this, "InstanceId", { value: host.ref });
    }
    // #endregion instance

    new CfnOutput(this, "KitBucketName", { value: kit.bucketName });
  }
}
