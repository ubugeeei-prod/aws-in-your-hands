import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";

import { type AuroraConfig, DATABASE_NAME } from "../../src/config.ts";

export type AuroraStackProps = StackProps & { config: AuroraConfig };

export class AuroraStack extends Stack {
  constructor(scope: Construct, id: string, props: AuroraStackProps) {
    super(scope, id, props);
    const { config } = props;
    const vpc = importNetwork(this, "Network");

    // #region network
    // Where instances may be placed. The storage is in three zones whatever
    // this says; these are the zones a writer or a reader can run in.
    const subnets = new rds.CfnDBSubnetGroup(this, "Subnets", {
      dbSubnetGroupDescription: "Private subnets of the chapter 11 VPC",
      subnetIds: vpc.isolatedSubnets.map((subnet) => subnet.subnetId),
    });

    // No rule lets anything in. A stack that runs a client inside the VPC adds
    // its own ingress rule to this group, and takes it away when it leaves.
    const group = new ec2.SecurityGroup(this, "ClusterSecurityGroup", {
      vpc,
      description: "Aurora cluster of chapter 60",
      allowAllOutbound: false,
    });
    // #endregion network

    // #region cluster
    // The cluster is the storage volume and its endpoints. It has no compute.
    const cluster = new rds.CfnDBCluster(this, "Cluster", {
      engine: "aurora-postgresql",
      engineVersion: config.engineVersion,
      databaseName: DATABASE_NAME,
      dbSubnetGroupName: subnets.ref,
      vpcSecurityGroupIds: [group.securityGroupId],
      storageEncrypted: true,
      // Aurora Standard is the default and is not echoed back when named, so it is left out.
      ...(config.storage === "aurora-iopt1" && { storageType: config.storage }),
      // Aurora creates the password, keeps it in Secrets Manager and rotates it.
      masterUsername: "postgres",
      manageMasterUserPassword: true,
      // SQL over HTTPS, so a caller outside the VPC needs no way into it.
      enableHttpEndpoint: true,
      serverlessV2ScalingConfiguration: {
        minCapacity: config.minCapacity,
        maxCapacity: config.maxCapacity,
        // Only meaningful, and only accepted, with a minimum of 0.
        ...(config.minCapacity === 0 && { secondsUntilAutoPause: config.secondsUntilAutoPause }),
      },
      // Exercise data. Production keeps the default of 1 day or more, turns
      // protection on, and takes a final snapshot.
      backupRetentionPeriod: 1,
      deletionProtection: false,
    });
    cluster.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // #endregion cluster

    // #region writer
    // Compute is added one instance at a time. The first becomes the writer;
    // a second one, in another zone, would be a reader and the failover target.
    const writer = new rds.CfnDBInstance(this, "Writer", {
      dbClusterIdentifier: cluster.ref,
      engine: "aurora-postgresql",
      dbInstanceClass: "db.serverless",
      publiclyAccessible: false,
    });
    writer.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // #endregion writer

    new CfnOutput(this, "ClusterArn", { value: cluster.attrDbClusterArn });
    new CfnOutput(this, "SecretArn", { value: cluster.attrMasterUserSecretSecretArn });
    new CfnOutput(this, "ClusterEndpoint", { value: cluster.attrEndpointAddress });
    new CfnOutput(this, "ReaderEndpoint", { value: cluster.attrReadEndpointAddress });
    new CfnOutput(this, "ClusterSecurityGroupId", { value: group.securityGroupId });
  }
}
