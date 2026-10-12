import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dms from "aws-cdk-lib/aws-dms";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";

import type { MigrationConfig } from "../../src/config.ts";
import { tableMappings } from "../../src/table-mappings.ts";
import { replicationSettings } from "../../src/task-settings.ts";

export type MigrationStackProps = StackProps & { config: MigrationConfig };

const POSTGRES_PORT = 5432;

export class MigrationStack extends Stack {
  constructor(scope: Construct, id: string, props: MigrationStackProps) {
    super(scope, id, props);
    const { config } = props;
    const vpc = importNetwork(this, "Network");

    // #region network
    // The replication runs inside the VPC. It may open exactly three kinds of
    // connection: to each database, and to the Secrets Manager endpoint.
    const replicationGroup = new ec2.CfnSecurityGroup(this, "ReplicationSecurityGroup", {
      groupDescription: "AWS DMS Serverless replication of chapter 39",
      vpcId: vpc.vpcId,
      securityGroupEgress: [
        {
          ipProtocol: "tcp",
          fromPort: POSTGRES_PORT,
          toPort: POSTGRES_PORT,
          destinationSecurityGroupId: config.source.securityGroupId,
          description: "PostgreSQL on the source",
        },
        {
          ipProtocol: "tcp",
          fromPort: POSTGRES_PORT,
          toPort: POSTGRES_PORT,
          destinationSecurityGroupId: config.target.securityGroupId,
          description: "PostgreSQL on the target",
        },
        {
          ipProtocol: "tcp",
          fromPort: 443,
          toPort: 443,
          cidrIp: vpc.vpcCidrBlock,
          description: "HTTPS to the interface endpoints of the VPC",
        },
      ],
    });
    // Each database's own group must let the replication in. These two rules
    // belong to this stack and leave with it.
    for (const [side, database] of [
      ["Source", config.source],
      ["Target", config.target],
    ] as const) {
      new ec2.CfnSecurityGroupIngress(this, `${side}AllowsReplication`, {
        groupId: database.securityGroupId,
        ipProtocol: "tcp",
        fromPort: POSTGRES_PORT,
        toPort: POSTGRES_PORT,
        sourceSecurityGroupId: replicationGroup.attrGroupId,
        description: "AWS DMS replication of chapter 39",
      });
    }
    // #endregion network

    // #region account-roles
    // AWS DMS looks these two up by name, so the names cannot be chosen, and an
    // account has one of each. `-c accountRoles=existing` leaves them alone.
    const accountRoles =
      config.accountRoles === "create"
        ? (
            [
              ["dms-vpc-role", "AmazonDMSVPCManagementRole"],
              ["dms-cloudwatch-logs-role", "AmazonDMSCloudWatchLogsRole"],
            ] as const
          ).map(
            ([roleName, policy]) =>
              new iam.Role(this, roleName, {
                roleName,
                assumedBy: new iam.ServicePrincipal("dms.amazonaws.com"),
                managedPolicies: [
                  iam.ManagedPolicy.fromAwsManagedPolicyName(`service-role/${policy}`),
                ],
              }),
          )
        : [];

    const subnetGroup = new dms.CfnReplicationSubnetGroup(this, "SubnetGroup", {
      replicationSubnetGroupDescription: "Private subnets of the chapter 11 VPC",
      subnetIds: vpc.isolatedSubnets.map((subnet) => subnet.subnetId),
    });
    // Creating a subnet group is the moment DMS assumes dms-vpc-role.
    for (const role of accountRoles) {
      subnetGroup.node.addDependency(role);
    }
    // #endregion account-roles

    // #region secrets
    // One database user per side, made for this migration. The password is
    // generated at deploy time and exists nowhere else.
    const credentials = (side: "Source" | "Target", username: string, host: string) =>
      new secretsmanager.Secret(this, `${side}Credentials`, {
        description: `AWS in Your Hands chapter 39: the AWS DMS user on the ${side.toLowerCase()} database`,
        generateSecretString: {
          // The four members AWS DMS reads from a secret.
          secretStringTemplate: JSON.stringify({ username, host, port: String(POSTGRES_PORT) }),
          generateStringKey: "password",
          passwordLength: 32,
          // AWS DMS refuses some punctuation in an endpoint password.
          excludePunctuation: true,
        },
        removalPolicy: RemovalPolicy.DESTROY,
      });
    const sourceSecret = credentials("Source", "dms_source", config.source.host);
    const targetSecret = credentials("Target", "dms_target", config.target.host);

    // The principal is the Regional one: that is who reads an endpoint's secret.
    const secretAccess = new iam.Role(this, "SecretAccess", {
      assumedBy: new iam.ServicePrincipal(`dms.${this.region}.amazonaws.com`),
    });
    secretAccess.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [sourceSecret.secretArn, targetSecret.secretArn],
      }),
    );
    // #endregion secrets

    // #region endpoints
    const source = new dms.CfnEndpoint(this, "Source", {
      endpointType: "source",
      engineName: "postgres",
      databaseName: config.source.databaseName,
      sslMode: "require",
      postgreSqlSettings: {
        secretsManagerSecretId: sourceSecret.secretArn,
        secretsManagerAccessRoleArn: secretAccess.roleArn,
        // No schema change is made during the migration, so DMS need not
        // create its DDL audit table and event trigger in the source.
        captureDdls: false,
        // Keeps the slot's restart_lsn moving while the source is quiet.
        heartbeatEnable: true,
        heartbeatSchema: "dms_heartbeat",
        // A note longer than LobMaxSize stops the task. It is not cut short.
        failTasksOnLobTruncation: true,
      },
    });
    const target = new dms.CfnEndpoint(this, "Target", {
      endpointType: "target",
      engineName: "aurora-postgresql",
      databaseName: config.target.databaseName,
      sslMode: "require",
      postgreSqlSettings: {
        secretsManagerSecretId: targetSecret.secretArn,
        secretsManagerAccessRoleArn: secretAccess.roleArn,
        // Tables arrive one at a time, in no promised order: a note can come
        // before its owner. Foreign keys stay quiet for this session only.
        afterConnectScript: "SET session_replication_role = replica",
      },
    });
    // The endpoints read their secrets through the role's policy.
    for (const endpoint of [source, target]) {
      endpoint.node.addDependency(secretAccess);
    }
    // #endregion endpoints

    // #region replication
    // A configuration, not a running thing: nothing is provisioned, and nothing
    // is billed, until someone starts the replication.
    const replication = new dms.CfnReplicationConfig(this, "Replication", {
      replicationConfigIdentifier: "aih-notes-to-aurora",
      replicationType: "full-load-and-cdc",
      sourceEndpointArn: source.ref,
      targetEndpointArn: target.ref,
      tableMappings,
      replicationSettings,
      computeConfig: {
        minCapacityUnits: config.minCapacityUnits,
        maxCapacityUnits: config.maxCapacityUnits,
        multiAz: false,
        replicationSubnetGroupId: subnetGroup.ref,
        vpcSecurityGroupIds: [replicationGroup.attrGroupId],
      },
    });
    // #endregion replication

    // #region failure
    // Every AWS DMS event of the Failure category in this account and Region.
    const failures = new sns.Topic(this, "Failures", { enforceSSL: true });
    new events.Rule(this, "OnFailure", {
      description: "An AWS DMS replication or task has failed",
      eventPattern: { source: ["aws.dms"], detail: { category: ["Failure"] } },
      targets: [new targets.SnsTopic(failures)],
    });
    // #endregion failure

    new CfnOutput(this, "ReplicationConfigArn", { value: replication.attrReplicationConfigArn });
    new CfnOutput(this, "SourceSecretArn", { value: sourceSecret.secretArn });
    new CfnOutput(this, "TargetSecretArn", { value: targetSecret.secretArn });
    new CfnOutput(this, "FailureTopicArn", { value: failures.topicArn });
    new CfnOutput(this, "ReplicationSecurityGroupId", { value: replicationGroup.attrGroupId });
  }
}
