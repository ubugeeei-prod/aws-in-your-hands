import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { parseDrConfig } from "../../src/config.ts";
import { DETAIL_TYPES } from "../../src/events.ts";
import { DrStack } from "../lib/dr-stack.ts";

type Resource = { Type: string; Properties?: Record<string, unknown> };
type Statement = {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
};

// Synthesized once per layout: every synth bundles the function with esbuild.
const synth = (settings: Record<string, unknown> = {}) => {
  const app = new App();
  const stack = new DrStack(app, "AihDr", {
    env: { region: "ap-northeast-1" },
    config: parseDrConfig(settings),
  });
  const template = Template.fromStack(stack);
  const json = template.toJSON() as { Resources: Record<string, Resource> };
  const of = (type: string): Resource[] =>
    Object.values(json.Resources).filter((resource) => resource.Type === type);
  const only = (type: string): Resource => {
    const [first, ...rest] = of(type);
    if (first === undefined || rest.length > 0) {
      throw new Error(`expected exactly one ${type}`);
    }
    return first;
  };
  const types = [
    ...new Set(Object.values(json.Resources).map((resource) => resource.Type)),
  ].toSorted();
  return { app, template, json, of, only, types };
};

const byDefault = synth();
const publicLayout = synth({ placement: "public" });
const attached = synth({
  sourceRoleName: "AihEc2-InstanceRole3CCE2F1D-abc123",
  sourceSecurityGroupId: "sg-0123456789abcdef0",
});
const declared = synth({ templates: "declare" });

// cdkd 0.296.28 registers a dedicated provider for each of these.
const DEDICATED = [
  "AWS::EC2::SecurityGroup",
  "AWS::Events::Rule",
  "AWS::IAM::ManagedPolicy",
  "AWS::IAM::Policy",
  "AWS::IAM::Role",
  "AWS::Lambda::Function",
  "AWS::Lambda::Permission",
  "AWS::Logs::LogGroup",
];
// No dedicated provider: cdkd falls back to Cloud Control API.
const CLOUD_CONTROL = ["AWS::EC2::VPCEndpoint"];

const statementsOf = (resource: Resource): Statement[] =>
  ((resource.Properties ?? {})["PolicyDocument"] as { Statement: Statement[] }).Statement;
const agentStatements = (layout: typeof byDefault): Statement[] =>
  statementsOf(layout.only("AWS::IAM::ManagedPolicy"));

describe("DrStack, default layout", () => {
  const { app, json, of, only, types } = byDefault;

  it("uses only resource types checked against cdkd, and declares no DRS resource", () => {
    expect(types).toEqual([...DEDICATED, ...CLOUD_CONTROL].toSorted());
    expect(types.filter((type) => type.startsWith("AWS::DRS::"))).toEqual([]);
  });

  it("adds the two endpoints the staging area needs, in the second zone only", () => {
    const endpoints = of("AWS::EC2::VPCEndpoint").map((endpoint) => endpoint.Properties ?? {});
    expect(endpoints.map((endpoint) => endpoint["ServiceName"]).toSorted()).toEqual([
      "com.amazonaws.ap-northeast-1.drs",
      "com.amazonaws.ap-northeast-1.ec2",
    ]);
    for (const endpoint of endpoints) {
      expect(endpoint).toMatchObject({
        VpcEndpointType: "Interface",
        PrivateDnsEnabled: true,
        SubnetIds: [{ "Fn::ImportValue": "AihNetwork-Private2SubnetId" }],
      });
    }
  });

  it("lets only HTTPS from inside the VPC reach the endpoints", () => {
    expect(only("AWS::EC2::SecurityGroup").Properties?.["SecurityGroupIngress"]).toEqual([
      {
        IpProtocol: "tcp",
        FromPort: 443,
        ToPort: 443,
        CidrIp: { "Fn::ImportValue": "AihNetwork-VpcCidr" },
        Description: "HTTPS from the VPC",
      },
    ]);
  });

  it("gives the agent these actions and no others", () => {
    const actions = agentStatements(byDefault).flatMap((statement) => statement.Action);
    expect(actions.toSorted()).toEqual(
      [
        "drs:CreateSourceServerForDrs",
        "drs:GetAgentCommandForDrs",
        "drs:GetAgentConfirmedResumeInfoForDrs",
        "drs:GetAgentInstallationAssetsForDrs",
        "drs:GetAgentReplicationInfoForDrs",
        "drs:GetAgentRuntimeConfigurationForDrs",
        "drs:SendAgentLogsForDrs",
        "drs:SendAgentMetricsForDrs",
        "drs:SendClientLogsForDrs",
        "drs:SendClientMetricsForDrs",
        "drs:TagResource",
        "drs:UpdateAgentBacklogForDrs",
        "drs:UpdateAgentConversionInfoForDrs",
        "drs:UpdateAgentReplicationInfoForDrs",
        "drs:UpdateAgentSourcePropertiesForDrs",
      ].toSorted(),
    );
    // Nothing that starts a recovery, reads a snapshot, or touches EC2, IAM, or STS.
    expect(actions.every((action) => action.startsWith("drs:") && !action.includes("*"))).toBe(
      true,
    );
  });

  it("uses a wildcard resource only where no source server exists to be named", () => {
    const wild = agentStatements(byDefault).filter((statement) => statement.Resource === "*");
    expect(wild.map((statement) => statement.Sid)).toEqual(["InstallAndRegister"]);
    const scoped = agentStatements(byDefault).filter((statement) => statement.Resource !== "*");
    for (const statement of scoped) {
      expect(JSON.stringify(statement.Resource)).toContain(":drs:ap-northeast-1:");
      expect(JSON.stringify(statement.Resource)).toContain(":source-server/*");
    }
  });

  it("allows tagging only while a source server is being created", () => {
    const tag = agentStatements(byDefault).find((statement) => statement.Sid === "TagOnCreate");
    expect(tag?.Condition).toEqual({
      StringEquals: { "drs:CreateAction": "CreateSourceServerForDrs" },
    });
  });

  it("attaches the agent's policy to no role, and changes no security group, until told which", () => {
    expect(only("AWS::IAM::ManagedPolicy").Properties?.["Roles"]).toBeUndefined();
    expect(of("AWS::EC2::SecurityGroupEgress")).toEqual([]);
  });

  it("routes launch, stall, and failback events to the function, and not the snapshot event", () => {
    expect(only("AWS::Events::Rule").Properties?.["EventPattern"]).toEqual({
      source: ["aws.drs"],
      "detail-type": Object.values(DETAIL_TYPES),
    });
    expect(JSON.stringify(only("AWS::Events::Rule"))).not.toContain("PIT Snapshot");
  });

  it("lets the function write its own log group and nothing else", () => {
    const statements = statementsOf(only("AWS::IAM::Policy"));
    expect(statements.flatMap((statement) => statement.Action).toSorted()).toEqual([
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    expect(statements.every((statement) => statement.Resource !== "*")).toBe(true);
    expect(only("AWS::IAM::Role").Properties?.["ManagedPolicyArns"]).toBeUndefined();
  });

  it("keeps event logs for a month and deletes them with the stack", () => {
    expect(only("AWS::Logs::LogGroup")).toMatchObject({
      Properties: { RetentionInDays: 30 },
      DeletionPolicy: "Delete",
    });
  });

  it("synthesizes without asking AWS anything", () => {
    expect(app.synth().manifest.missing).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("Fn::GetAZs");
  });
});

describe("DrStack, other layouts", () => {
  it("creates nothing billed by the hour with `placement=public`", () => {
    expect(publicLayout.types).toEqual(
      DEDICATED.filter((type) => type !== "AWS::EC2::SecurityGroup"),
    );
    expect(publicLayout.json.Resources).not.toHaveProperty("EndpointSecurityGroup");
  });

  it("attaches to the chapter 23 role by name and opens one outbound port on its group", () => {
    expect(attached.only("AWS::IAM::ManagedPolicy").Properties?.["Roles"]).toEqual([
      "AihEc2-InstanceRole3CCE2F1D-abc123",
    ]);
    expect(attached.only("AWS::EC2::SecurityGroupEgress").Properties).toEqual({
      GroupId: "sg-0123456789abcdef0",
      IpProtocol: "tcp",
      FromPort: 1500,
      ToPort: 1500,
      CidrIp: { "Fn::ImportValue": "AihNetwork-VpcCidr" },
      Description: "Block replication to the staging area",
    });
    // Another stack's role and group are referenced, never created or replaced here.
    expect(attached.of("AWS::IAM::Role")).toHaveLength(1);
  });

  it("declares the two templates only on request, with the three fixed-shape PIT rules", () => {
    expect(declared.types.filter((type) => type.startsWith("AWS::DRS::"))).toEqual([
      "AWS::DRS::LaunchConfigurationTemplate",
      "AWS::DRS::ReplicationConfigurationTemplate",
    ]);
    expect(declared.only("AWS::DRS::ReplicationConfigurationTemplate").Properties).toEqual({
      StagingAreaSubnetId: { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
      AssociateDefaultSecurityGroup: true,
      ReplicationServersSecurityGroupsIDs: [],
      ReplicationServerInstanceType: "t3.small",
      UseDedicatedReplicationServer: false,
      DefaultLargeStagingDiskType: "AUTO",
      EbsEncryption: "DEFAULT",
      BandwidthThrottling: 0,
      DataPlaneRouting: "PRIVATE_IP",
      CreatePublicIP: false,
      StagingAreaTags: { "aih:chapter": "40", "aih:stack": "AihDr" },
      PitPolicy: [
        { RuleID: 1, Units: "MINUTE", Interval: 10, RetentionDuration: 60, Enabled: true },
        { RuleID: 2, Units: "HOUR", Interval: 1, RetentionDuration: 24, Enabled: true },
        { RuleID: 3, Units: "DAY", Interval: 1, RetentionDuration: 7, Enabled: true },
      ],
      AutoReplicateNewDisks: true,
    });
    expect(declared.only("AWS::DRS::LaunchConfigurationTemplate").Properties).toEqual({
      LaunchDisposition: "STARTED",
      TargetInstanceTypeRightSizingMethod: "NONE",
      CopyPrivateIp: false,
      CopyTags: true,
      PostLaunchEnabled: false,
      LaunchIntoSourceInstance: false,
    });
  });
});
