import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { parseRunnerConfig, RUNNER, TIMING } from "../../src/config.ts";
import { RunnerStack } from "../lib/runner-stack.ts";

type Resource = { Type: string; Properties?: Record<string, unknown>; DeletionPolicy?: string };
type Statement = {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
};

function synth(input: unknown) {
  const app = new App();
  const stack = new RunnerStack(app, "AihCiRunners", {
    env: { region: "ap-northeast-1" },
    config: parseRunnerConfig(input),
  });
  const resources = Template.fromStack(stack).toJSON()["Resources"] as Record<string, Resource>;
  const ofType = (type: string): [string, Resource][] =>
    Object.entries(resources).filter(([, resource]) => resource.Type === type);
  const role = (prefix: string): Resource => {
    const found = ofType("AWS::IAM::Role").filter(([id]) => id.startsWith(prefix));
    if (found.length !== 1 || found[0] === undefined) {
      throw new Error(`expected one role named ${prefix}*, found ${found.length}`);
    }
    return found[0][1];
  };
  /** Inline policies of the role, and any AWS::IAM::Policy attached to it. */
  const statements = (prefix: string): Statement[] => {
    const inline = (role(prefix).Properties?.["Policies"] ?? []) as {
      PolicyDocument: { Statement: Statement[] };
    }[];
    const attached = ofType("AWS::IAM::Policy")
      .filter(([id]) => id.startsWith(prefix))
      .map(([, policy]) => policy.Properties?.["PolicyDocument"] as { Statement: Statement[] });
    return [...inline.map((policy) => policy.PolicyDocument), ...attached].flatMap(
      (document) => document.Statement,
    );
  };
  return { resources, ofType, role, statements, missing: app.synth().manifest.missing };
}

const stack = synth({ repositories: "example-org/notes", appClientId: "Iv23example" });
const actions = (statement: Statement): string[] => [statement.Action].flat();
const container = (): Record<string, unknown> => {
  const [[, task] = []] = stack.ofType("AWS::ECS::TaskDefinition");
  const [first] = (task?.Properties?.["ContainerDefinitions"] ?? []) as Record<string, unknown>[];
  return first ?? {};
};

describe("what a job can reach", () => {
  it("gives the task role no permission at all", () => {
    expect(stack.statements("TaskRole")).toEqual([]);
    expect(stack.role("TaskRole").Properties).not.toHaveProperty("ManagedPolicyArns");
  });

  it("lets the execution role write the runner's log and nothing else", () => {
    const allowed = stack.statements("ExecutionRole").flatMap(actions);
    expect(allowed.toSorted()).toEqual(["logs:CreateLogStream", "logs:PutLogEvents"]);
  });

  it("puts no secret and no credential into the task definition", () => {
    expect(container()).not.toHaveProperty("Secrets");
    expect(container()).not.toHaveProperty("Environment");
  });

  it("runs the pinned image unprivileged, with the runner as its entry point", () => {
    expect(container()["Image"]).toBe(RUNNER.image);
    expect(container()["EntryPoint"]).toEqual([RUNNER.entryPoint]);
    expect(container()).not.toHaveProperty("Privileged");
  });

  it("lets nothing in and only HTTPS out", () => {
    const [[, group] = []] = stack.ofType("AWS::EC2::SecurityGroup");
    expect(group?.Properties).not.toHaveProperty("SecurityGroupIngress");
    expect(stack.ofType("AWS::EC2::SecurityGroupIngress")).toEqual([]);
    expect(group?.Properties?.["SecurityGroupEgress"]).toEqual([
      expect.objectContaining({ IpProtocol: "tcp", FromPort: 443, ToPort: 443 }),
    ]);
  });
});

describe("what the receiver can do", () => {
  const statements = stack.statements("ReceiverRole");

  it("has exactly these actions", () => {
    expect(statements.flatMap(actions).toSorted()).toEqual([
      "dynamodb:DeleteItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "ecs:RunTask",
      "iam:PassRole",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "secretsmanager:GetSecretValue",
    ]);
  });

  it("names every resource: no statement reaches *", () => {
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).not.toContain('"*"');
    }
  });

  it("can start only the runner's task definition, only in its cluster", () => {
    const run = statements.find((statement) => statement.Sid === "StartRunners");
    expect(run?.Resource).toEqual({ Ref: expect.stringMatching(/^Runner/) });
    expect(run?.Condition).toEqual({
      ArnEquals: { "ecs:cluster": { "Fn::GetAtt": [expect.stringMatching(/^Cluster/), "Arn"] } },
    });
  });

  it("can pass only the two task roles, and only to ECS", () => {
    const pass = statements.find((statement) => statement.Sid === "PassTheTaskRoles");
    expect(pass?.Resource).toHaveLength(2);
    expect(pass?.Condition).toEqual({
      StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
    });
  });

  it("answers within GitHub's ten seconds or not at all", () => {
    const [, receiver] =
      stack.ofType("AWS::Lambda::Function").find(([id]) => id.startsWith("Receiver")) ?? [];
    expect(receiver?.Properties?.["Timeout"]).toBe(TIMING.receiverTimeout);
  });

  it("is reachable without IAM, because GitHub cannot sign for it", () => {
    const [[, url] = []] = stack.ofType("AWS::Lambda::Url");
    expect(url?.Properties?.["AuthType"]).toBe("NONE");
  });
});

describe("what the sweeper can do", () => {
  const statements = stack.statements("SweeperRole");

  it("lists, describes and stops tasks, and only in this cluster", () => {
    expect(statements.flatMap(actions).toSorted()).toEqual([
      "ecs:DescribeTasks",
      "ecs:ListTasks",
      "ecs:StopTask",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    const list = statements.find((statement) => statement.Sid === "ListTheClustersTasks");
    expect(list?.Condition).toHaveProperty("ArnEquals");
    const stop = statements.find((statement) => statement.Sid === "StopOldRunners");
    expect(JSON.stringify(stop?.Resource)).toContain(":task/");
  });
});

describe("the stack as a whole", () => {
  it("refuses every delivery until a repository and an app are named", () => {
    const bare = synth({});
    const [, receiver] =
      bare.ofType("AWS::Lambda::Function").find(([id]) => id.startsWith("Receiver")) ?? [];
    const environment = receiver?.Properties?.["Environment"] as
      | { Variables: Record<string, string> }
      | undefined;
    const variables = environment?.Variables ?? {};
    expect(variables["REPOSITORIES"]).toBe("");
    expect(variables["APP_CLIENT_ID"]).toBe("");
  });

  it("keeps the private key out of the template", () => {
    expect(JSON.stringify(stack.resources)).not.toContain("BEGIN");
  });

  it("leaves nothing behind when destroyed", () => {
    for (const [, resource] of Object.entries(stack.resources)) {
      expect(resource.DeletionPolicy ?? "Delete").toBe("Delete");
    }
  });

  it("asks AWS nothing at synthesis", () => {
    expect(stack.missing ?? []).toEqual([]);
  });

  // Each type was looked up in cdkd 0.296.28's register-providers.ts. Only the last goes through Cloud Control.
  it("uses only resource types that were checked against cdkd", () => {
    const types = [...new Set(Object.values(stack.resources).map((resource) => resource.Type))];
    expect(types.toSorted()).toEqual([
      "AWS::DynamoDB::Table",
      "AWS::EC2::SecurityGroup",
      "AWS::ECS::Cluster",
      "AWS::ECS::TaskDefinition",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Lambda::Url",
      "AWS::Logs::LogGroup",
      "AWS::Scheduler::Schedule",
      "AWS::SecretsManager::Secret",
    ]);
  });
});
