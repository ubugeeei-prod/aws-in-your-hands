import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { RULES } from "@aih/example-33-production-readiness/src/rules/rule.ts";
import { readTemplate } from "@aih/example-33-production-readiness/src/template.ts";

import { parseSandboxConfig, REAPER_SCHEDULE, TASK } from "../../src/config.ts";
import { can, rolePolicy, trustedPrincipals } from "../../src/policy.ts";
import { AgentSandboxStack } from "../lib/agent-sandbox-stack.ts";

type Resource = { Type: string; Properties?: Record<string, unknown>; DeletionPolicy?: string };

// Two made-up accounts: the one the sandbox is deployed to, and the one it must not reach.
const SANDBOX = "111111111111";
const PRODUCTION = "999999999999";
const scope = { partition: "aws", region: "ap-northeast-1", account: SANDBOX };
const MODEL = "anthropic.claude-haiku-4-5-20251001-v1:0";
const PROFILE = `arn:aws:bedrock:ap-northeast-1:${SANDBOX}:inference-profile/jp.${MODEL}`;

function synth(input: Record<string, string>) {
  const app = new App();
  const stack = new AgentSandboxStack(app, "AihAgentSandbox", {
    env: { region: "ap-northeast-1" },
    config: parseSandboxConfig(input),
  });
  const json = Template.fromStack(stack).toJSON();
  const resources = json["Resources"] as Record<string, Resource>;
  const template = readTemplate(json);
  const idOf = (type: string, prefix: string): string => {
    const found = Object.keys(resources).filter(
      (id) => resources[id]?.Type === type && id.startsWith(prefix),
    );
    if (found.length !== 1 || found[0] === undefined) {
      throw new Error(`expected one ${type} named ${prefix}*, found ${found.length}`);
    }
    return found[0];
  };
  const role = (prefix: string) => rolePolicy(template, idOf("AWS::IAM::Role", prefix), scope);
  return { resources, template, idOf, role, missing: app.synth().manifest.missing };
}

const repositoryOnly = synth({});
const sandbox = synth({ imageTag: "a1", repositories: "acme/notes" });
const withExec = synth({ imageTag: "a1", repositories: "acme/notes", exec: "true" });
const withEndpoint = synth({ imageTag: "a1", repositories: "acme/notes", modelEndpoint: "true" });

const ROLES = ["ExecutionRole", "TaskRole", "LauncherRole", "ReaperRole", "ScheduleRole"];

describe("without an image tag", () => {
  it("is the repository alone", () => {
    expect(Object.values(repositoryOnly.resources).map((resource) => resource.Type)).toEqual([
      "AWS::ECR::Repository",
    ]);
  });
});

// The chapter's invariant: nothing the agent can do from inside reaches production data or the deploy role.
describe("what the agent's role can reach", () => {
  const { statements, unread } = sandbox.role("TaskRole");

  it("was read completely: no managed policy, no boundary, nothing the evaluator skipped", () => {
    expect(unread).toEqual([]);
    for (const name of ROLES) {
      expect(sandbox.role(name).unread, name).toEqual([]);
    }
  });

  it("can call the pinned model, by its profile and in the profile's two Regions", () => {
    for (const action of ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]) {
      expect(can(statements, action, PROFILE)).toBe(true);
      for (const region of ["ap-northeast-1", "ap-northeast-3"]) {
        expect(
          can(statements, action, `arn:aws:bedrock:${region}::foundation-model/${MODEL}`),
        ).toBe(true);
      }
    }
    expect(statements.flatMap((statement) => statement.actions).toSorted()).toEqual([
      "bedrock:InvokeModel",
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:InvokeModelWithResponseStream",
    ]);
  });

  it("cannot call another model, or this one in another Region", () => {
    const others = [
      `arn:aws:bedrock:ap-northeast-1:${SANDBOX}:inference-profile/global.anthropic.claude-opus-5-5`,
      "arn:aws:bedrock:ap-northeast-1::foundation-model/anthropic.claude-opus-5-5",
      `arn:aws:bedrock:us-east-1::foundation-model/${MODEL}`,
      `arn:aws:bedrock:ap-northeast-1:${PRODUCTION}:inference-profile/jp.${MODEL}`,
    ];
    for (const resource of others) {
      expect(can(statements, "bedrock:InvokeModel", resource), resource).toBe(false);
    }
  });

  it("cannot reach production, in this account or in another", () => {
    const probes: [string, string][] = [
      // The deploy role of chapter 20, and any role at all.
      ["sts:AssumeRole", `arn:aws:iam::${PRODUCTION}:role/aih-deploy`],
      ["sts:AssumeRole", `arn:aws:iam::${SANDBOX}:role/aih-deploy`],
      ["iam:PassRole", `arn:aws:iam::${SANDBOX}:role/anything`],
      // The notes, their attachments, the secrets.
      ["dynamodb:GetItem", `arn:aws:dynamodb:ap-northeast-1:${PRODUCTION}:table/notes`],
      ["dynamodb:Scan", `arn:aws:dynamodb:ap-northeast-1:${SANDBOX}:table/notes`],
      ["s3:GetObject", "arn:aws:s3:::aih-attachments/owner/file"],
      ["s3:PutObject", "arn:aws:s3:::aih-attachments/owner/file"],
      [
        "secretsmanager:GetSecretValue",
        `arn:aws:secretsmanager:ap-northeast-1:${SANDBOX}:secret:aih/agent-sandbox/github-app-AbCdEf`,
      ],
      ["ssm:GetParameter", `arn:aws:ssm:ap-northeast-1:${SANDBOX}:parameter/prod/db`],
      ["kms:Decrypt", `arn:aws:kms:ap-northeast-1:${PRODUCTION}:key/1234`],
      // More of itself.
      ["ecs:RunTask", `arn:aws:ecs:ap-northeast-1:${SANDBOX}:task-definition/x:1`],
      ["lambda:InvokeFunction", `arn:aws:lambda:ap-northeast-1:${SANDBOX}:function:x`],
      ["ec2:RunInstances", "*"],
      ["cloudformation:CreateStack", "*"],
    ];
    for (const [action, resource] of probes) {
      expect(can(statements, action, resource), `${action} on ${resource}`).toBe(false);
    }
  });

  it("cannot write, change, or delete the log that records it", () => {
    const logGroup = `<${sandbox.idOf("AWS::Logs::LogGroup", "TaskLogs")}.Arn>`;
    for (const action of [
      "logs:PutLogEvents",
      "logs:DeleteLogStream",
      "logs:DeleteLogGroup",
      "logs:PutRetentionPolicy",
    ]) {
      expect(can(statements, action, logGroup), action).toBe(false);
    }
    // The container's output is written for it, by the role its code never holds.
    expect(can(sandbox.role("ExecutionRole").statements, "logs:PutLogEvents", logGroup)).toBe(true);
    expect(can(statements, "cloudtrail:StopLogging", "*")).toBe(false);
  });

  it("can be assumed by ECS tasks only, and passed by the launcher only", () => {
    const taskRole = sandbox.idOf("AWS::IAM::Role", "TaskRole");
    expect(trustedPrincipals(sandbox.template, taskRole)).toEqual(["ecs-tasks.amazonaws.com"]);
    const passers = ROLES.filter((name) =>
      can(sandbox.role(name).statements, "iam:PassRole", `<${taskRole}.Arn>`),
    );
    expect(passers).toEqual(["LauncherRole"]);
  });

  it("with exec=true: gains the four channel actions and nothing else", () => {
    const more = withExec.role("TaskRole").statements;
    const added = more
      .flatMap((statement) => statement.actions)
      .filter((action) => !action.startsWith("bedrock:"));
    expect(added).toEqual([
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]);
    expect(can(more, "sts:AssumeRole", `arn:aws:iam::${PRODUCTION}:role/aih-deploy`)).toBe(false);
    expect(can(statements, "ssmmessages:OpenDataChannel", "*")).toBe(false);
  });
});

describe("the two functions around the tasks", () => {
  const launcher = sandbox.role("LauncherRole").statements;
  const reaper = sandbox.role("ReaperRole").statements;
  const taskDefinition = `<${sandbox.idOf("AWS::ECS::TaskDefinition", "Task")}>`;
  const cluster = sandbox.idOf("AWS::ECS::Cluster", "Cluster");
  const aTask = `arn:aws:ecs:ap-northeast-1:${SANDBOX}:task/<${cluster}>/0123456789abcdef`;

  it("lets the launcher start this task definition and no other", () => {
    expect(can(launcher, "ecs:RunTask", taskDefinition)).toBe(true);
    expect(
      can(launcher, "ecs:RunTask", `arn:aws:ecs:ap-northeast-1:${SANDBOX}:task-definition/other:1`),
    ).toBe(false);
    expect(can(launcher, "ecs:StopTask", aTask)).toBe(false);
    expect(can(launcher, "bedrock:InvokeModel", PROFILE)).toBe(false);
  });

  it("lets the launcher read one secret, and nobody else read any", () => {
    const key = `arn:aws:secretsmanager:ap-northeast-1:${SANDBOX}:secret:aih/agent-sandbox/github-app-AbCdEf`;
    expect(can(launcher, "secretsmanager:GetSecretValue", key)).toBe(true);
    expect(can(launcher, "secretsmanager:GetSecretValue", `${key.slice(0, -17)}other-AbCdEf`)).toBe(
      false,
    );
    for (const name of ROLES.filter((role) => role !== "LauncherRole")) {
      expect(can(sandbox.role(name).statements, "secretsmanager:GetSecretValue", key), name).toBe(
        false,
      );
    }
  });

  it("lets the reaper stop tasks of this cluster, and start none", () => {
    expect(can(reaper, "ecs:StopTask", aTask)).toBe(true);
    expect(
      can(reaper, "ecs:StopTask", `arn:aws:ecs:ap-northeast-1:${SANDBOX}:task/production/abc`),
    ).toBe(false);
    expect(can(reaper, "ecs:RunTask", taskDefinition)).toBe(false);
    expect(can(reaper, "iam:PassRole", "*")).toBe(false);
  });

  it("runs the reaper once a minute, from a schedule that can invoke that function only", () => {
    const schedule = sandbox.resources[sandbox.idOf("AWS::Scheduler::Schedule", "ReaperSchedule")];
    const reaperId = sandbox.idOf("AWS::Lambda::Function", "Reaper");
    expect(schedule?.Properties).toMatchObject({
      ScheduleExpression: REAPER_SCHEDULE,
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: { Arn: { "Fn::GetAtt": [reaperId, "Arn"] } },
    });
    expect(sandbox.role("ScheduleRole").statements).toEqual([
      {
        effect: "Allow",
        actions: ["lambda:InvokeFunction"],
        resources: [`<${reaperId}.Arn>`],
        conditional: false,
      },
    ]);
  });

  it("gives the launcher no door from the internet", () => {
    const types = Object.values(sandbox.resources).map((resource) => resource.Type);
    for (const type of ["AWS::Lambda::Url", "AWS::Lambda::Permission", "AWS::ApiGatewayV2::Api"]) {
      expect(types).not.toContain(type);
    }
  });

  it("tells the launcher the allowed repositories and the reaper nothing it does not need", () => {
    const environment = (prefix: string): Record<string, unknown> => {
      const properties =
        sandbox.resources[sandbox.idOf("AWS::Lambda::Function", prefix)]?.Properties ?? {};
      return (properties["Environment"] as { Variables: Record<string, unknown> }).Variables;
    };
    expect(environment("Launcher")).toMatchObject({
      ALLOWED_REPOSITORIES: "acme/notes",
      EXEC: "false",
    });
    expect(Object.keys(environment("Reaper"))).not.toContain("GITHUB_APP_SECRET_ARN");
    expect(Object.keys(environment("Reaper"))).not.toContain("ALLOWED_REPOSITORIES");
  });
});

describe("the task", () => {
  const definition = (layout: typeof sandbox) =>
    layout.resources[layout.idOf("AWS::ECS::TaskDefinition", "Task")]?.Properties ?? {};
  const container = (layout: typeof sandbox) =>
    ((definition(layout)["ContainerDefinitions"] ?? []) as Record<string, unknown>[])[0] ?? {};

  it("is one arm64 container with the memory Claude Code's setup page asks for", () => {
    expect(definition(sandbox)).toMatchObject({
      Cpu: String(TASK.cpuUnits),
      Memory: String(TASK.memoryMiB),
      NetworkMode: "awsvpc",
      RequiresCompatibilities: ["FARGATE"],
      RuntimePlatform: { CpuArchitecture: "ARM64", OperatingSystemFamily: "LINUX" },
    });
    expect(TASK.memoryMiB).toBeGreaterThanOrEqual(4096);
    expect(definition(sandbox)["ContainerDefinitions"]).toHaveLength(1);
  });

  it("has a read-only root and three empty volumes that end with the task", () => {
    expect(container(sandbox)).toMatchObject({ ReadonlyRootFilesystem: true });
    expect(container(sandbox)).not.toHaveProperty("Privileged");
    expect(container(sandbox)).not.toHaveProperty("PortMappings");
    expect(definition(sandbox)["Volumes"]).toEqual([
      { Name: "workspace" },
      { Name: "home" },
      { Name: "tmp" },
    ]);
  });

  it("holds no secret and no token in its definition", () => {
    expect(container(sandbox)).not.toHaveProperty("Secrets");
    expect(container(sandbox)["Environment"]).toEqual([
      { Name: "MODEL", Value: `jp.${MODEL}` },
      { Name: "AWS_REGION", Value: "ap-northeast-1" },
    ]);
  });

  it("names its image by a tag of a repository whose tags cannot be moved", () => {
    expect(
      repositoryOnly.resources[repositoryOnly.idOf("AWS::ECR::Repository", "Repository")]
        ?.Properties,
    ).toMatchObject({ ImageTagMutability: "IMMUTABLE" });
    expect(JSON.stringify(container(sandbox)["Image"])).toContain(":a1");
  });

  it("lets nothing in, and only HTTPS out", () => {
    const group =
      sandbox.resources[sandbox.idOf("AWS::EC2::SecurityGroup", "TaskGroup")]?.Properties;
    expect(group).not.toHaveProperty("SecurityGroupIngress");
    expect(group?.["SecurityGroupEgress"]).toEqual([
      {
        CidrIp: "0.0.0.0/0",
        Description: "HTTPS out",
        FromPort: 443,
        IpProtocol: "tcp",
        ToPort: 443,
      },
    ]);
    expect(Object.values(sandbox.resources).map((resource) => resource.Type)).not.toContain(
      "AWS::EC2::SecurityGroupIngress",
    );
  });

  it("with exec=true: gives up the read-only root, as ECS Exec requires", () => {
    expect(container(withExec)).toMatchObject({
      ReadonlyRootFilesystem: false,
      LinuxParameters: { InitProcessEnabled: true },
    });
  });
});

describe("the endpoint for the model", () => {
  it("is not there by default: nothing in the stack is billed by the hour", () => {
    const types = Object.values(sandbox.resources).map((resource) => resource.Type);
    for (const hourly of [
      "AWS::EC2::VPCEndpoint",
      "AWS::EC2::NatGateway",
      "AWS::ECS::Service",
      "AWS::ElasticLoadBalancingV2::LoadBalancer",
      "AWS::NetworkFirewall::Firewall",
    ]) {
      expect(types).not.toContain(hourly);
    }
  });

  it("with modelEndpoint=true: admits the task role and the pinned model only", () => {
    const endpoint =
      withEndpoint.resources[withEndpoint.idOf("AWS::EC2::VPCEndpoint", "ModelEndpoint")];
    const taskRole = withEndpoint.idOf("AWS::IAM::Role", "TaskRole");
    expect(endpoint?.Properties).toMatchObject({
      VpcEndpointType: "Interface",
      PrivateDnsEnabled: true,
      ServiceName: "com.amazonaws.ap-northeast-1.bedrock-runtime",
      SubnetIds: [
        { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
        { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
      ],
    });
    const document = (endpoint?.Properties ?? {})["PolicyDocument"] as {
      Statement: Record<string, unknown>[];
    };
    const [statement, ...rest] = document.Statement;
    expect(rest).toEqual([]);
    expect(statement).toMatchObject({
      Effect: "Allow",
      Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      Condition: { ArnEquals: { "aws:PrincipalArn": { "Fn::GetAtt": [taskRole, "Arn"] } } },
    });
    expect(JSON.stringify(statement?.["Resource"])).not.toContain('"*"');
  });
});

describe("what the stack leaves behind, and what it is made of", () => {
  it("has exactly these wildcard resources, by chapter 21's lint through chapter 33's rule", () => {
    const found = RULES["iam-wildcard"].check(sandbox.template).map((problem) => problem.detail);
    expect(found.toSorted()).toEqual([
      'wildcard-resource: cloudwatch:GetMetricData on Resource "*"',
      'wildcard-resource: cloudwatch:GetMetricData on Resource "*"',
      'wildcard-resource: ecr:GetAuthorizationToken on Resource "*"',
      'wildcard-resource: ecs:ListTasks on Resource "*"',
      'wildcard-resource: ecs:ListTasks on Resource "*"',
    ]);
    // None of them is on the role the agent holds.
    expect(
      RULES["iam-wildcard"]
        .check(sandbox.template)
        .map((problem) => problem.resource)
        .join(" "),
    ).not.toContain("TaskRole");
  });

  it("fails chapter 33's review where a practice stack is expected to, and nowhere else", () => {
    const findings = Object.fromEntries(
      Object.entries(RULES)
        .map(([id, rule]) => [id, rule.check(sandbox.template).length] as const)
        .filter(([, count]) => count > 0),
    );
    // Logs that go with the stack, and no alarm on either function: both are for production to change.
    expect(findings).toEqual({ "iam-wildcard": 5, "stateful-delete": 3, "function-alarm": 2 });
  });

  it("keeps a month of logs and removes everything on destroy", () => {
    for (const [id, resource] of Object.entries(sandbox.resources)) {
      expect(resource.DeletionPolicy ?? "Delete", id).toBe("Delete");
      if (resource.Type === "AWS::Logs::LogGroup") {
        expect(resource.Properties?.["RetentionInDays"], id).toBe(30);
      }
    }
  });

  it("asks AWS nothing during synthesis, and names no account", () => {
    expect(sandbox.missing).toBeUndefined();
    expect(/:\d{12}:/.test(JSON.stringify(sandbox.resources))).toBe(false);
  });

  it("uses only resource types and properties the pinned cdkd has an implementation for", () => {
    // From the handledProperties tables in the installed @go-to-k/cdkd 0.296.28.
    const handled: Record<string, string[]> = {
      "AWS::EC2::SecurityGroup": [
        "GroupDescription",
        "SecurityGroupEgress",
        "SecurityGroupIngress",
        "VpcId",
      ],
      "AWS::ECR::Repository": ["EmptyOnDelete", "ImageTagMutability", "LifecyclePolicy"],
      "AWS::ECS::Cluster": [],
      "AWS::ECS::TaskDefinition": [
        "ContainerDefinitions",
        "Cpu",
        "ExecutionRoleArn",
        "Family",
        "Memory",
        "NetworkMode",
        "RequiresCompatibilities",
        "RuntimePlatform",
        "TaskRoleArn",
        "Volumes",
      ],
      "AWS::IAM::Policy": ["PolicyDocument", "PolicyName", "Roles"],
      "AWS::IAM::Role": ["AssumeRolePolicyDocument"],
      "AWS::Lambda::Function": [
        "Architectures",
        "Code",
        "Environment",
        "Handler",
        "LoggingConfig",
        "MemorySize",
        "Role",
        "Runtime",
        "Timeout",
      ],
      "AWS::Logs::LogGroup": ["RetentionInDays"],
      "AWS::Scheduler::Schedule": [
        "Description",
        "FlexibleTimeWindow",
        "ScheduleExpression",
        "Target",
      ],
    };
    for (const layout of [sandbox, withExec]) {
      for (const [id, resource] of Object.entries(layout.resources)) {
        expect(Object.keys(handled), id).toContain(resource.Type);
        for (const property of Object.keys(resource.Properties ?? {})) {
          expect(handled[resource.Type], `${id}.${property}`).toContain(property);
        }
      }
    }
    // The endpoint has no implementation of its own in cdkd: it would go through Cloud Control.
    const extra = Object.values(withEndpoint.resources)
      .map((resource) => resource.Type)
      .filter((type) => !Object.hasOwn(handled, type));
    expect([...new Set(extra)].toSorted()).toEqual([
      "AWS::EC2::SecurityGroupIngress",
      "AWS::EC2::VPCEndpoint",
    ]);
  });
});
