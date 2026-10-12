import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";

import type { NitroConfig } from "../../src/config.ts";
import { keyPolicy } from "../../src/policy.ts";

export type NitroStackProps = StackProps & { config: NitroConfig };

export class NitroStack extends Stack {
  constructor(scope: Construct, id: string, props: NitroStackProps) {
    super(scope, id, props);
    const { config } = props;
    const named = (name: string) => [{ key: "Name", value: `${id}/${name}` }];

    // #region network
    // The chapter 11 VPC. A public subnet: building an enclave image pulls from a registry,
    // and chapter 11 has no endpoint for KMS.
    const vpc = importNetwork(this, "Network");
    const subnet = vpc.publicSubnets[0];
    if (subnet === undefined) {
      throw new Error("the network has no public subnet");
    }
    // No inbound rule. A session is opened from the inside by SSM Agent, as in chapter 23.
    const securityGroup = new ec2.CfnSecurityGroup(this, "ParentSecurityGroup", {
      groupDescription: "Chapter 68 parent instance: nothing in, HTTPS out",
      vpcId: vpc.vpcId,
      securityGroupEgress: [
        {
          ipProtocol: "tcp",
          fromPort: 443,
          toPort: 443,
          cidrIp: "0.0.0.0/0",
          description: "HTTPS to AWS APIs and image registries",
        },
      ],
      tags: named("parent"),
    });
    // #endregion network

    // #region role
    // No KMS action here. What this role may do with the key is written in the key policy,
    // where the attestation condition is.
    const role = new iam.Role(this, "ParentRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "The chapter 68 parent instance. Its enclaves send requests as this role",
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    const profile = new iam.CfnInstanceProfile(this, "ParentProfile", { roles: [role.roleName] });
    // #endregion role

    // #region key
    // CfnKey, not kms.Key: the policy below is the whole policy, with nothing appended to it.
    const key = new kms.CfnKey(this, "NotesKey", {
      description: "AWS in Your Hands chapter 68: wraps the data key of each note",
      keyPolicy: keyPolicy({
        accountRoot: `arn:${this.partition}:iam::${this.account}:root`,
        enclaveRole: role.roleArn,
        measurement: config.measurement,
      }),
      // The shortest wait KMS allows before a key is gone for good.
      pendingWindowInDays: 7,
    });
    // A practice key. Every note sealed under it becomes unreadable when it is deleted.
    key.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // #endregion key

    // #region instance
    const imageId =
      config.amiId ??
      new ec2.AmazonLinux2023ImageSsmParameter({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
        kernel: ec2.AmazonLinux2023Kernel.DEFAULT,
        // Left to its default, this class looks the AMI up during synth and wants an account for it.
        cachedInContext: false,
      }).getImage(this).imageId;

    const instance = new ec2.CfnInstance(this, "Parent", {
      imageId,
      instanceType: config.instanceType,
      iamInstanceProfile: profile.ref,
      // Changing this replaces the instance: CloudFormation lists it as "Update requires: Replacement".
      enclaveOptions: { enabled: true },
      networkInterfaces: [
        {
          deviceIndex: "0",
          subnetId: subnet.subnetId,
          groupSet: [securityGroup.attrGroupId],
          associatePublicIpAddress: true,
        },
      ],
      metadataOptions: {
        httpEndpoint: "enabled",
        httpTokens: "required",
        // One hop, as in chapter 23: the role's credentials reach the instance, not a container on it.
        httpPutResponseHopLimit: 1,
      },
      tags: named("parent"),
    });
    // #endregion instance

    new CfnOutput(this, "InstanceId", { value: instance.ref });
    new CfnOutput(this, "KeyId", { value: key.ref });
    new CfnOutput(this, "ParentRoleArn", { value: role.roleArn });
  }
}
