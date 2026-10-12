import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { parseRdsConfig } from "../../src/config.ts";
import { RdsStack } from "../lib/rds-stack.ts";

// Synthesis bundles two handlers with esbuild, so each variant is built once for the file.
const synth = (context: Record<string, unknown> = {}) =>
  Template.fromStack(
    new RdsStack(new App(), "AihRds", {
      env: { region: "ap-northeast-1" },
      config: parseRdsConfig({ allowedOrigin: "https://d111.cloudfront.net", ...context }),
    }),
  );
const practice = synth();
const production = synth({ profile: "production" });
const withReplica = synth({ readReplica: "true" });

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const statementsOf = (template: Template): Statement[] =>
  Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
  );
const typesOf = (template: Template): string[] => {
  const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
  return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
};

describe("RdsStack, as practised", () => {
  it("keeps the instance off the internet, encrypted, in the private subnets", () => {
    practice.resourceCountIs("AWS::RDS::DBInstance", 1);
    practice.hasResourceProperties("AWS::RDS::DBInstance", {
      Engine: "postgres",
      EngineVersion: "18.3",
      DBInstanceClass: "db.t4g.micro",
      AllocatedStorage: "20",
      StorageType: "gp3",
      PubliclyAccessible: false,
      StorageEncrypted: true,
      MultiAZ: false,
      EnableIAMDatabaseAuthentication: true,
      DBName: "notes",
    });
    practice.hasResourceProperties("AWS::RDS::DBSubnetGroup", {
      SubnetIds: [
        { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
        { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
      ],
    });
  });

  it("lets PostgreSQL in from the functions only, and nothing out of the database", () => {
    const groups = practice.findResources("AWS::EC2::SecurityGroup");
    expect(Object.keys(groups)).toHaveLength(2);
    // No rule of either group names an address range. CDK's "no traffic" placeholder aside.
    for (const group of Object.values(groups)) {
      const rules = [
        ...((group["Properties"].SecurityGroupIngress ?? []) as { CidrIp?: string }[]),
        ...((group["Properties"].SecurityGroupEgress ?? []) as { CidrIp?: string }[]),
      ];
      for (const rule of rules) {
        expect(rule.CidrIp).toBe("255.255.255.255/32");
      }
    }
    practice.resourceCountIs("AWS::EC2::SecurityGroupIngress", 1);
    practice.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      IpProtocol: "tcp",
      FromPort: 5432,
      ToPort: 5432,
      GroupId: { "Fn::GetAtt": [Match.stringLikeRegexp("^DatabaseGroup"), "GroupId"] },
      SourceSecurityGroupId: {
        "Fn::GetAtt": [Match.stringLikeRegexp("^FunctionGroup"), "GroupId"],
      },
    });
    practice.resourceCountIs("AWS::EC2::SecurityGroupEgress", 1);
    practice.hasResourceProperties("AWS::EC2::SecurityGroupEgress", {
      FromPort: 5432,
      ToPort: 5432,
      GroupId: { "Fn::GetAtt": [Match.stringLikeRegexp("^FunctionGroup"), "GroupId"] },
    });
  });

  it("has RDS manage the master password, and puts no password in the template", () => {
    practice.hasResourceProperties("AWS::RDS::DBInstance", {
      MasterUsername: "notes_admin",
      ManageMasterUserPassword: true,
      MasterUserPassword: Match.absent(),
    });
    practice.resourceCountIs("AWS::SecretsManager::Secret", 0);
    expect(JSON.stringify(practice.toJSON())).not.toContain("resolve:secretsmanager");
    practice.hasOutput("MasterSecretArn", {
      Value: { "Fn::GetAtt": [Match.stringLikeRegexp("^Database"), "MasterUserSecret.SecretArn"] },
    });
  });

  it("lets each function sign in as one database user, and read no secret", () => {
    const statements = statementsOf(practice);
    const actions = [...new Set(statements.flatMap((statement) => statement.Action))].toSorted();
    expect(actions).toEqual([
      "ec2:AssignPrivateIpAddresses",
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DescribeSubnets",
      "ec2:UnassignPrivateIpAddresses",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "rds-db:connect",
    ]);
    // The six network interface actions are the one place Lambda requires "*".
    for (const statement of statements) {
      const everything = JSON.stringify(statement.Resource) === '"*"';
      expect(everything).toBe([statement.Action].flat().every((a) => a.startsWith("ec2:")));
    }
    const users = statements
      .filter((statement) => statement.Action === "rds-db:connect")
      .map((statement) => JSON.stringify(statement.Resource));
    expect(users).toHaveLength(2);
    expect(users.filter((arn) => arn.includes('"/notes_api"'))).toHaveLength(1);
    expect(users.filter((arn) => arn.includes('"/notes_migrator"'))).toHaveLength(1);
    for (const arn of users) {
      expect(arn).toContain(":dbuser:");
      expect(arn).toContain("DbiResourceId");
    }
    practice.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("puts both functions in the private subnets and points them at the endpoint name", () => {
    const functions = Object.values(practice.findResources("AWS::Lambda::Function"));
    expect(functions).toHaveLength(2);
    for (const fn of functions) {
      const properties = fn["Properties"];
      expect(properties).toMatchObject({ Runtime: "nodejs24.x", Architectures: ["arm64"] });
      expect(properties.VpcConfig.SubnetIds).toEqual([
        { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
        { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
      ]);
      expect(properties.Environment.Variables).toMatchObject({
        DB_HOST: { "Fn::GetAtt": [expect.stringMatching(/^Database/), "Endpoint.Address"] },
        DB_NAME: "notes",
        NODE_EXTRA_CA_CERTS: "/var/runtime/ca-cert.pem",
      });
      // No password, no secret ARN: the functions hold nothing worth stealing.
      expect(JSON.stringify(properties.Environment.Variables)).not.toMatch(/secret|password/i);
    }
  });

  it("routes the API to the handler only, and throttles it", () => {
    const routes = Object.values(practice.findResources("AWS::ApiGatewayV2::Route"))
      .map((route) => route["Properties"].RouteKey as string)
      .toSorted();
    expect(routes).toEqual([
      "DELETE /notes/{id}",
      "GET /health",
      "GET /notes",
      "GET /notes/{id}",
      "POST /notes",
      "PUT /notes/{id}",
    ]);
    // One integration and one permission: nothing public reaches the operations function.
    practice.resourceCountIs("AWS::ApiGatewayV2::Integration", 1);
    practice.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
      RouteSettings: Match.absent(),
    });
    practice.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      CorsConfiguration: {
        AllowHeaders: ["content-type", "x-notes-seen"],
        ExposeHeaders: ["x-notes-seen", "x-notes-read-from"],
      },
    });
  });

  it("logs slow statements, requires TLS, and keeps the database log for a week", () => {
    practice.hasResourceProperties("AWS::RDS::DBParameterGroup", {
      Family: "postgres18",
      Parameters: { log_min_duration_statement: "500", "rds.force_ssl": "1" },
    });
    practice.hasResourceProperties("AWS::RDS::DBInstance", {
      EnableCloudwatchLogsExports: ["postgresql"],
    });
    practice.hasResource("AWS::Logs::LogGroup", {
      Properties: { LogGroupName: "/aws/rds/instance/aih-notes/postgresql", RetentionInDays: 7 },
      DeletionPolicy: "Delete",
    });
    // No custom resource: nothing in this stack runs code of its own at deploy time.
    expect(typesOf(practice).filter((type) => type.startsWith("Custom::"))).toEqual([]);
  });

  it("never drifts into paid extended support, and takes minor versions by itself", () => {
    practice.hasResourceProperties("AWS::RDS::DBInstance", {
      EngineLifecycleSupport: "open-source-rds-extended-support-disabled",
      AutoMinorVersionUpgrade: true,
      PreferredBackupWindow: "17:00-17:30",
      PreferredMaintenanceWindow: "sun:18:00-sun:18:30",
    });
  });

  it("is deleted with the stack, backups included", () => {
    practice.hasResource("AWS::RDS::DBInstance", {
      Properties: {
        DeletionProtection: false,
        DeleteAutomatedBackups: true,
        BackupRetentionPeriod: 1,
        MaxAllocatedStorage: Match.absent(),
      },
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
    for (const type of ["AWS::RDS::DBSubnetGroup", "AWS::RDS::DBParameterGroup"]) {
      practice.hasResource(type, { DeletionPolicy: "Delete" });
    }
  });

  it("alarms before the volume is full", () => {
    practice.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/RDS",
      MetricName: "FreeStorageSpace",
      Dimensions: [{ Name: "DBInstanceIdentifier", Value: "aih-notes" }],
      ComparisonOperator: "LessThanThreshold",
      Threshold: 4 * 1024 ** 3,
      TreatMissingData: "notBreaching",
    });
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    expect(typesOf(practice)).toEqual([
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      "AWS::CloudWatch::Alarm",
      "AWS::EC2::SecurityGroup",
      // No provider registered for this one either. Cloud Control API lists it.
      "AWS::EC2::SecurityGroupEgress",
      "AWS::EC2::SecurityGroupIngress",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
      "AWS::RDS::DBInstance",
      // No dedicated provider in cdkd 0.296.28: goes through Cloud Control API.
      "AWS::RDS::DBParameterGroup",
      "AWS::RDS::DBSubnetGroup",
    ]);
  });
});

describe("RdsStack, with the production profile", () => {
  it("has a standby, survives the stack, and may grow its volume", () => {
    production.hasResource("AWS::RDS::DBInstance", {
      Properties: {
        MultiAZ: true,
        DeletionProtection: true,
        DeleteAutomatedBackups: false,
        BackupRetentionPeriod: 14,
        MaxAllocatedStorage: 100,
      },
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });
});

describe("RdsStack, with a read replica", () => {
  it("adds one replica of the instance, private and with IAM sign-in", () => {
    withReplica.resourceCountIs("AWS::RDS::DBInstance", 2);
    withReplica.hasResourceProperties("AWS::RDS::DBInstance", {
      SourceDBInstanceIdentifier: Match.anyValue(),
      DBInstanceIdentifier: "aih-notes-replica",
      PubliclyAccessible: false,
      EnableIAMDatabaseAuthentication: true,
      MultiAZ: false,
    });
    const handler = Object.values(withReplica.findResources("AWS::Lambda::Function")).find(
      (fn) => fn["Properties"].Environment.Variables.DB_REPLICA_HOST !== undefined,
    );
    expect(handler?.["Properties"].Environment.Variables.DB_REPLICA_HOST).toEqual({
      "Fn::GetAtt": [expect.stringMatching(/^Replica/), "Endpoint.Address"],
    });
  });

  it("gives up the managed master password, which RDS will not combine with a replica", () => {
    withReplica.hasResourceProperties("AWS::RDS::DBInstance", {
      MasterUsername: "notes_admin",
      ManageMasterUserPassword: Match.absent(),
    });
    // Generated once by CloudFormation. Nothing rotates it.
    withReplica.resourceCountIs("AWS::SecretsManager::Secret", 1);
    withReplica.resourceCountIs("AWS::SecretsManager::RotationSchedule", 0);
    withReplica.hasOutput("MasterSecretArn", { Value: { Ref: Match.stringLikeRegexp("Secret") } });
  });

  it("lets the API's role sign in to both instances, as the same user", () => {
    const users = statementsOf(withReplica)
      .filter((statement) => statement.Action === "rds-db:connect")
      .map((statement) => JSON.stringify(statement.Resource));
    expect(users.filter((arns) => arns.split('"/notes_api"').length === 3)).toHaveLength(1);
  });
});
