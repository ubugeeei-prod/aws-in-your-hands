import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { timing } from "@aih/example-12-containers/src/timing.ts";

import { JOB, parseFargateConfig, SCALING } from "../../src/config.ts";
import { FargateStack } from "../lib/fargate-stack.ts";

type Resource = {
  Type: string;
  Properties?: Record<string, unknown>;
  DeletionPolicy?: string;
  DependsOn?: string[];
};
type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
};

const statementsOf = (policy: Resource): Statement[] =>
  ((policy.Properties?.["PolicyDocument"] ?? { Statement: [] }) as { Statement: Statement[] })
    .Statement;

function synth(input: unknown) {
  const app = new App();
  const stack = new FargateStack(app, "AihFargate", {
    env: { region: "ap-northeast-1" },
    config: parseFargateConfig(input),
  });
  const template = Template.fromStack(stack);
  const resources = template.toJSON()["Resources"] as Record<string, Resource>;
  const ofType = (type: string): [string, Resource][] =>
    Object.entries(resources).filter(([, resource]) => resource.Type === type);
  const one = (type: string, idPrefix: string): [string, Resource] => {
    const found = ofType(type).filter(([id]) => id.startsWith(idPrefix));
    if (found.length !== 1 || found[0] === undefined) {
      throw new Error(`expected one ${type} named ${idPrefix}*, found ${found.length}`);
    }
    return found[0];
  };
  const statements = (rolePrefix: string): Statement[] =>
    ofType("AWS::IAM::Policy")
      .filter(([id]) => id.startsWith(rolePrefix))
      .flatMap(([, policy]) => statementsOf(policy));
  return {
    template,
    resources,
    ofType,
    one,
    statements,
    missing: app.synth().manifest.missing,
  };
}

const repositoryOnly = synth({});
const running = synth({ imageTag: "f1" });
const withExec = synth({ imageTag: "f1", exec: "true" });
const inPrivate = synth({ imageTag: "f1", taskSubnets: "private" });

const container = (layout: typeof running, definition: string): Record<string, unknown> => {
  const [, task] = layout.one("AWS::ECS::TaskDefinition", definition);
  const [first] = (task.Properties?.["ContainerDefinitions"] ?? []) as Record<string, unknown>[];
  return first ?? {};
};
const wildcards = (list: Statement[]): string[] =>
  list
    .filter((statement) => JSON.stringify(statement.Resource).includes('"*"'))
    .flatMap((statement) => statement.Action);

describe("FargateStack without an image tag", () => {
  it("is the repository alone, with nothing billed by the hour", () => {
    expect(Object.values(repositoryOnly.resources).map((resource) => resource.Type)).toEqual([
      "AWS::ECR::Repository",
    ]);
  });
});

describe("where the tasks run", () => {
  it("associates both Fargate capacity providers with the cluster itself", () => {
    running.template.hasResourceProperties("AWS::ECS::Cluster", {
      CapacityProviders: ["FARGATE", "FARGATE_SPOT"],
    });
    // The association as a separate resource has no ordering with the service.
    expect(running.ofType("AWS::ECS::ClusterCapacityProviderAssociations")).toEqual([]);
  });

  it("keeps the tasks the service can never go below on on-demand Fargate", () => {
    const [, service] = running.one("AWS::ECS::Service", "Service");
    expect(service.Properties?.["CapacityProviderStrategy"]).toEqual([
      { CapacityProvider: "FARGATE", Base: SCALING.minTasks, Weight: 1 },
      { CapacityProvider: "FARGATE_SPOT", Weight: 3 },
    ]);
    // A launch type and a strategy exclude each other.
    expect(service.Properties).not.toHaveProperty("LaunchType");
    running.template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalableTarget", {
      MinCapacity: SCALING.minTasks,
      MaxCapacity: SCALING.maxTasks,
    });
    expect(service.Properties?.["DesiredCount"]).toBe(SCALING.minTasks);
  });

  it("runs the nightly job on Spot only, in the same subnets and behind the same firewall", () => {
    const [, schedule] = running.one("AWS::Scheduler::Schedule", "JobSchedule");
    const [jobId] = running.one("AWS::ECS::TaskDefinition", "Job");
    const [clusterId] = running.one("AWS::ECS::Cluster", "Cluster");
    expect(schedule.Properties).toMatchObject({
      ScheduleExpression: JOB.schedule,
      ScheduleExpressionTimezone: "Asia/Tokyo",
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: {
        Arn: { "Fn::GetAtt": [clusterId, "Arn"] },
        EcsParameters: {
          TaskDefinitionArn: { Ref: jobId },
          TaskCount: 1,
          CapacityProviderStrategy: [{ CapacityProvider: "FARGATE_SPOT", Weight: 1 }],
          NetworkConfiguration: {
            AwsvpcConfiguration: {
              AssignPublicIp: "ENABLED",
              Subnets: [
                { "Fn::ImportValue": "AihNetwork-Public1SubnetId" },
                { "Fn::ImportValue": "AihNetwork-Public2SubnetId" },
              ],
              SecurityGroups: [{ "Fn::GetAtt": [expect.stringMatching(/^TaskGroup/), "GroupId"] }],
            },
          },
        },
        RetryPolicy: {
          MaximumRetryAttempts: JOB.retryAttempts,
          MaximumEventAgeInSeconds: JOB.maxEventAgeSeconds,
        },
      },
    });
    const target = schedule.Properties?.["Target"] as { EcsParameters: Record<string, unknown> };
    expect(target.EcsParameters).not.toHaveProperty("LaunchType");
    expect(target.EcsParameters).not.toHaveProperty("EnableExecuteCommand");
  });

  it("with taskSubnets=private: no public address for the service or for the job", () => {
    const [, service] = inPrivate.one("AWS::ECS::Service", "Service");
    expect(service.Properties?.["NetworkConfiguration"]).toMatchObject({
      AwsvpcConfiguration: {
        AssignPublicIp: "DISABLED",
        Subnets: [
          { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
          { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
        ],
      },
    });
    const [, schedule] = inPrivate.one("AWS::Scheduler::Schedule", "JobSchedule");
    expect(JSON.stringify(schedule.Properties)).toContain('"AssignPublicIp":"DISABLED"');
    expect(JSON.stringify(schedule.Properties)).not.toContain("Public1SubnetId");
  });
});

describe("scaling in without cutting requests", () => {
  it("steers by CPU and by requests per task, with a slow way back in", () => {
    const policies = running
      .ofType("AWS::ApplicationAutoScaling::ScalingPolicy")
      .map(
        ([, policy]) =>
          policy.Properties?.["TargetTrackingScalingPolicyConfiguration"] as Record<
            string,
            unknown
          >,
      );
    expect(policies).toHaveLength(2);
    expect(policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          PredefinedMetricSpecification: {
            PredefinedMetricType: "ECSServiceAverageCPUUtilization",
          },
          TargetValue: SCALING.targetCpuPercent,
        }),
        expect.objectContaining({
          PredefinedMetricSpecification: expect.objectContaining({
            PredefinedMetricType: "ALBRequestCountPerTarget",
          }),
          TargetValue: SCALING.targetRequestsPerTask,
        }),
      ]),
    );
    for (const policy of policies) {
      expect(policy).toMatchObject({
        ScaleOutCooldown: SCALING.scaleOutCooldown,
        ScaleInCooldown: SCALING.scaleInCooldown,
      });
      // Scale-in stays on: a service that only grows is a bill that only grows.
      expect(policy).not.toHaveProperty("DisableScaleIn");
    }
    expect(SCALING.scaleInCooldown).toBeGreaterThan(SCALING.scaleOutCooldown);
  });

  it("gives a task that is taken away as long as chapter 12's longest request", () => {
    running.template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      TargetGroupAttributes: Match.arrayWith([
        { Key: "deregistration_delay.timeout_seconds", Value: String(timing.deregistrationDelay) },
      ]),
    });
    expect(timing.deregistrationDelay).toBeGreaterThanOrEqual(timing.longestRequest);
    for (const definition of ["Task", "Job"]) {
      expect(container(running, definition)).toMatchObject({ StopTimeout: timing.stopTimeout });
    }
    running.template.hasResourceProperties("AWS::ECS::Service", {
      DeploymentConfiguration: {
        MinimumHealthyPercent: 100,
        MaximumPercent: 200,
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      },
    });
  });
});

describe("permissions", () => {
  it("gives the code nothing, and the agent only the pull and the log stream", () => {
    expect(running.statements("TaskRole")).toEqual([]);
    expect(running.statements("JobRole")).toEqual([]);
    const execution = running.statements("ExecutionRole");
    expect(execution.flatMap((statement) => statement.Action).toSorted()).toEqual([
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetAuthorizationToken",
      "ecr:GetDownloadUrlForLayer",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    // ecr:GetAuthorizationToken has no resource to name; it is the one "*" in the stack.
    expect(wildcards(execution)).toEqual(["ecr:GetAuthorizationToken"]);
    for (const [, role] of running.ofType("AWS::IAM::Role")) {
      expect(role.Properties).not.toHaveProperty("ManagedPolicyArns");
      expect(role.Properties).not.toHaveProperty("Policies");
    }
  });

  it("lets the schedule start the job's task definition and pass its two roles, nothing more", () => {
    const [jobId] = running.one("AWS::ECS::TaskDefinition", "Job");
    const [jobRoleId] = running.one("AWS::IAM::Role", "JobRole");
    const [executionRoleId] = running.one("AWS::IAM::Role", "ExecutionRole");
    expect(running.statements("ScheduleRole")).toEqual([
      {
        Effect: "Allow",
        Action: "iam:PassRole",
        Resource: [
          { "Fn::GetAtt": [jobRoleId, "Arn"] },
          { "Fn::GetAtt": [executionRoleId, "Arn"] },
        ],
        Condition: { StringLike: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
      },
      { Effect: "Allow", Action: "ecs:RunTask", Resource: { Ref: jobId } },
    ]);
    const [, role] = running.one("AWS::IAM::Role", "ScheduleRole");
    expect(JSON.stringify(role.Properties?.["AssumeRolePolicyDocument"])).toContain(
      ":schedule-group/default",
    );
  });

  it("has exactly one wildcard resource in the whole default stack", () => {
    const all = running.ofType("AWS::IAM::Policy").flatMap(([, policy]) => statementsOf(policy));
    expect(wildcards(all)).toEqual(["ecr:GetAuthorizationToken"]);
    expect(all.flatMap((statement) => statement.Action).join(" ")).not.toContain("*");
  });
});

describe("ECS Exec", () => {
  it("is off by default: no switch, no channel to Systems Manager, a read-only file system", () => {
    const [, service] = running.one("AWS::ECS::Service", "Service");
    expect(service.Properties).not.toHaveProperty("EnableExecuteCommand");
    expect(JSON.stringify(running.resources)).not.toContain("ssmmessages");
    expect(container(running, "Task")).toMatchObject({ ReadonlyRootFilesystem: true });
    expect(container(running, "Task")).not.toHaveProperty("LinuxParameters");
  });

  it("with exec=true: the four channel actions for the service's tasks, and a writable root", () => {
    const [, service] = withExec.one("AWS::ECS::Service", "Service");
    expect(service.Properties?.["EnableExecuteCommand"]).toBe(true);
    expect(withExec.statements("TaskRole")).toEqual([
      {
        Effect: "Allow",
        Action: [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ],
        Resource: "*",
      },
    ]);
    // The agent writes its files into the container: the price of a shell is the read-only root.
    expect(container(withExec, "Task")).toMatchObject({
      ReadonlyRootFilesystem: false,
      LinuxParameters: { InitProcessEnabled: true },
    });
    // The policy has to exist before a task starts with it.
    expect(service.DependsOn).toEqual(
      expect.arrayContaining([expect.stringMatching(/^TaskRoleDefaultPolicy/)]),
    );
  });

  it("with exec=true: the job is left as it was", () => {
    expect(withExec.statements("JobRole")).toEqual([]);
    expect(container(withExec, "Job")).toEqual(container(running, "Job"));
    expect(container(withExec, "Job")).toMatchObject({
      Command: ["node", "job.mjs"],
      ReadonlyRootFilesystem: true,
    });
  });

  it("refuses anything but the two words", () => {
    expect(() => parseFargateConfig({ imageTag: "f1", exec: "yes" })).toThrow(/exec/);
    expect(parseFargateConfig({ imageTag: "f1" }).exec).toBe(false);
  });
});

describe("what the stack leaves behind, and what it is made of", () => {
  it("removes everything on destroy", () => {
    for (const [id, resource] of Object.entries(running.resources)) {
      expect(resource.DeletionPolicy ?? "Delete", id).toBe("Delete");
    }
    running.template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 7 },
      DeletionPolicy: "Delete",
    });
  });

  it("asks AWS nothing during synthesis, and names no account", () => {
    expect(running.missing).toBeUndefined();
    expect(/:\d{12}:/.test(JSON.stringify(running.resources))).toBe(false);
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    // From the handledProperties tables of the providers registered in
    // src/provisioning/register-providers.ts at v0.296.28.
    const handled: Record<string, string[]> = {
      "AWS::EC2::SecurityGroup": [
        "GroupDescription",
        "SecurityGroupEgress",
        "SecurityGroupIngress",
        "VpcId",
      ],
      "AWS::EC2::SecurityGroupIngress": [
        "Description",
        "FromPort",
        "GroupId",
        "IpProtocol",
        "SourceSecurityGroupId",
        "ToPort",
      ],
      "AWS::ECR::Repository": ["EmptyOnDelete", "ImageTagMutability", "LifecyclePolicy"],
      "AWS::ECS::Cluster": ["CapacityProviders"],
      "AWS::ECS::Service": [
        "CapacityProviderStrategy",
        "Cluster",
        "DeploymentConfiguration",
        "DeploymentController",
        "DesiredCount",
        "EnableECSManagedTags",
        "EnableExecuteCommand",
        "HealthCheckGracePeriodSeconds",
        "LoadBalancers",
        "NetworkConfiguration",
        "TaskDefinition",
      ],
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
      ],
      "AWS::ElasticLoadBalancingV2::Listener": [
        "DefaultActions",
        "LoadBalancerArn",
        "Port",
        "Protocol",
      ],
      "AWS::ElasticLoadBalancingV2::LoadBalancer": [
        "LoadBalancerAttributes",
        "Scheme",
        "SecurityGroups",
        "Subnets",
        "Type",
      ],
      "AWS::ElasticLoadBalancingV2::TargetGroup": [
        "HealthCheckIntervalSeconds",
        "HealthCheckPath",
        "HealthCheckTimeoutSeconds",
        "HealthyThresholdCount",
        "Matcher",
        "Port",
        "Protocol",
        "TargetGroupAttributes",
        "TargetType",
        "UnhealthyThresholdCount",
        "VpcId",
      ],
      "AWS::IAM::Policy": ["PolicyDocument", "PolicyName", "Roles"],
      "AWS::IAM::Role": ["AssumeRolePolicyDocument"],
      "AWS::Logs::LogGroup": ["RetentionInDays"],
      "AWS::Scheduler::Schedule": [
        "Description",
        "FlexibleTimeWindow",
        "ScheduleExpression",
        "ScheduleExpressionTimezone",
        "Target",
      ],
    };
    // No provider of its own in that file, and not on cdkd's unsupported list: Cloud Control.
    const viaCloudControl = [
      "AWS::ApplicationAutoScaling::ScalableTarget",
      "AWS::ApplicationAutoScaling::ScalingPolicy",
      "AWS::EC2::SecurityGroupEgress",
    ];

    for (const layout of [running, withExec, inPrivate]) {
      const types = [
        ...new Set(Object.values(layout.resources).map((resource) => resource.Type)),
      ].toSorted();
      expect(types).toEqual([...Object.keys(handled), ...viaCloudControl].toSorted());
      for (const [id, resource] of Object.entries(layout.resources)) {
        const allowed = handled[resource.Type];
        if (allowed !== undefined) {
          expect(allowed, id).toEqual(
            expect.arrayContaining(Object.keys(resource.Properties ?? {})),
          );
        }
      }
    }
  });
});
