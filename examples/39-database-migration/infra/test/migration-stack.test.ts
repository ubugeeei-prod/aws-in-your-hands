import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { parseMigrationConfig } from "../../src/config.ts";
import { tableMappingsSchema } from "../../src/table-mappings.ts";
import { MigrationStack } from "../lib/migration-stack.ts";

const context = {
  sourceHost: "old.abc.ap-northeast-1.rds.amazonaws.com",
  sourceSecurityGroupId: "sg-0aaaaaaaaaaaaaaaa",
  targetHost: "new.cluster-abc.ap-northeast-1.rds.amazonaws.com",
  targetSecurityGroupId: "sg-0bbbbbbbbbbbbbbbb",
};

const synth = (extra: Record<string, unknown> = {}): Template =>
  Template.fromStack(
    new MigrationStack(new App(), "AihDatabaseMigration", {
      env: { region: "ap-northeast-1" },
      config: parseMigrationConfig({ ...context, ...extra }),
    }),
  );

const template = synth();

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };

describe("MigrationStack", () => {
  it("creates a configuration and no replication instance: nothing runs until it is started", () => {
    template.resourceCountIs("AWS::DMS::ReplicationInstance", 0);
    template.resourceCountIs("AWS::DMS::ReplicationTask", 0);
    template.hasResourceProperties("AWS::DMS::ReplicationConfig", {
      ReplicationType: "full-load-and-cdc",
      ComputeConfig: { MinCapacityUnits: 1, MaxCapacityUnits: 2, MultiAZ: false },
    });
  });

  it("hands DMS the table mappings and settings the local tests check, unchanged", () => {
    const [replication] = Object.values(template.findResources("AWS::DMS::ReplicationConfig"));
    const properties = replication?.["Properties"];
    expect(v.safeParse(tableMappingsSchema, properties.TableMappings).success).toBe(true);
    expect(properties.ReplicationSettings).toMatchObject({
      FullLoadSettings: { TargetTablePrepMode: "DO_NOTHING" },
      TargetMetadata: { LimitedSizeLobMode: true, LobMaxSize: 64 },
      ValidationSettings: { EnableValidation: true },
    });
  });

  it("puts no user name and no password in an endpoint: both read a secret through one role", () => {
    const endpoints = Object.values(template.findResources("AWS::DMS::Endpoint"));
    expect(endpoints).toHaveLength(2);
    for (const endpoint of endpoints) {
      const properties = endpoint["Properties"];
      expect(properties.Username).toBeUndefined();
      expect(properties.Password).toBeUndefined();
      expect(properties.ServerName).toBeUndefined();
      expect(properties.SslMode).toBe("require");
      expect(properties.PostgreSqlSettings.SecretsManagerSecretId).toHaveProperty("Ref");
    }
    template.hasResourceProperties("AWS::DMS::Endpoint", {
      EndpointType: "source",
      EngineName: "postgres",
      PostgreSqlSettings: {
        CaptureDdls: false,
        HeartbeatEnable: true,
        FailTasksOnLobTruncation: true,
      },
    });
    template.hasResourceProperties("AWS::DMS::Endpoint", {
      EndpointType: "target",
      EngineName: "aurora-postgresql",
      PostgreSqlSettings: { AfterConnectScript: "SET session_replication_role = replica" },
    });
  });

  it("generates each password at deploy time, without punctuation, and deletes the secret with the stack", () => {
    template.resourceCountIs("AWS::SecretsManager::Secret", 2);
    template.allResources("AWS::SecretsManager::Secret", { DeletionPolicy: "Delete" });
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      GenerateSecretString: {
        GenerateStringKey: "password",
        ExcludePunctuation: true,
        SecretStringTemplate: JSON.stringify({
          username: "dms_source",
          host: context.sourceHost,
          port: "5432",
        }),
      },
    });
  });

  it("lets the secret role read these two secrets and nothing else", () => {
    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]?.Action).toBe("secretsmanager:GetSecretValue");
    expect(statements[0]?.Resource).toEqual([
      { Ref: expect.stringMatching(/^SourceCredentials/) },
      { Ref: expect.stringMatching(/^TargetCredentials/) },
    ]);
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({ Principal: { Service: "dms.ap-northeast-1.amazonaws.com" } }),
        ],
      },
      ManagedPolicyArns: Match.absent(),
    });
  });

  it("creates the two roles DMS finds by name, and can leave them to an account that has them", () => {
    const names = (t: Template) =>
      Object.values(t.findResources("AWS::IAM::Role"))
        .map((role) => role["Properties"].RoleName as string | undefined)
        .filter((name) => name !== undefined)
        .toSorted();
    expect(names(template)).toEqual(["dms-cloudwatch-logs-role", "dms-vpc-role"]);
    template.hasResource("AWS::DMS::ReplicationSubnetGroup", {
      DependsOn: Match.arrayWith([Match.stringLikeRegexp("^dmsvpcrole")]),
    });

    const existing = synth({ accountRoles: "existing" });
    expect(names(existing)).toEqual([]);
    existing.resourceCountIs("AWS::IAM::Role", 1);
  });

  it("opens the databases to the replication only, and the replication to the databases and HTTPS only", () => {
    const ingress = Object.values(template.findResources("AWS::EC2::SecurityGroupIngress")).map(
      (rule) => rule["Properties"],
    );
    expect(ingress.map((rule) => rule.GroupId).toSorted()).toEqual([
      context.sourceSecurityGroupId,
      context.targetSecurityGroupId,
    ]);
    for (const rule of ingress) {
      expect(rule).toMatchObject({ IpProtocol: "tcp", FromPort: 5432, ToPort: 5432 });
      expect(rule.SourceSecurityGroupId).toHaveProperty("Fn::GetAtt");
      expect(rule.CidrIp).toBeUndefined();
    }

    const [group] = Object.values(template.findResources("AWS::EC2::SecurityGroup"));
    const properties = group?.["Properties"];
    expect(properties.SecurityGroupIngress).toBeUndefined();
    expect(
      properties.SecurityGroupEgress.map((rule: { FromPort: number }) => rule.FromPort),
    ).toEqual([5432, 5432, 443]);
    expect(JSON.stringify(properties.SecurityGroupEgress)).not.toContain("0.0.0.0/0");
  });

  it("places the replication in the private subnets of the chapter 11 network", () => {
    template.hasResourceProperties("AWS::DMS::ReplicationSubnetGroup", {
      SubnetIds: [
        { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
        { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
      ],
    });
  });

  it("sends every DMS failure event to a topic that only accepts TLS", () => {
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: { source: ["aws.dms"], detail: { category: ["Failure"] } },
      Targets: [Match.objectLike({ Arn: { Ref: Match.stringLikeRegexp("^Failures") } })],
    });
    const policies = Object.values(template.findResources("AWS::SNS::TopicPolicy"));
    expect(JSON.stringify(policies)).toContain("events.amazonaws.com");
    expect(JSON.stringify(policies)).toContain('"aws:SecureTransport":"false"');
  });

  it("refuses context that is not a host, a security group ID, or an offered capacity", () => {
    expect(() => parseMigrationConfig({ sourceHost: "old db" })).toThrow();
    expect(() => parseMigrationConfig({ targetSecurityGroupId: "0.0.0.0/0" })).toThrow();
    expect(() => parseMigrationConfig({ maxCapacityUnits: "3" })).toThrow();
    expect(() => parseMigrationConfig({ minCapacityUnits: "4", maxCapacityUnits: "2" })).toThrow();
    expect(parseMigrationConfig({ maxCapacityUnits: "4" }).maxCapacityUnits).toBe(4);
  });

  it("synthesizes without context, pointing at hosts that cannot exist", () => {
    const placeholder = synth({ sourceHost: undefined, targetHost: undefined });
    expect(JSON.stringify(placeholder.toJSON())).toContain("source.database.invalid");
  });

  it("uses only resource types whose route in the pinned cdkd is written down", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      // No provider in cdkd 0.296.28. Not in the Cloud Control API's list of supported types.
      "AWS::DMS::Endpoint",
      // No provider in cdkd 0.296.28. Supported by the Cloud Control API.
      "AWS::DMS::ReplicationConfig",
      // No provider in cdkd 0.296.28. Not in the Cloud Control API's list of supported types.
      "AWS::DMS::ReplicationSubnetGroup",
      "AWS::EC2::SecurityGroup",
      "AWS::EC2::SecurityGroupIngress",
      "AWS::Events::Rule",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::SNS::Topic",
      "AWS::SNS::TopicPolicy",
      "AWS::SecretsManager::Secret",
    ]);
  });
});
