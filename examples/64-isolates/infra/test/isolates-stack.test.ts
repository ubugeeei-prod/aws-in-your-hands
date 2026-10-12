import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { timing } from "@aih/example-12-containers/src/timing.ts";

import { parseIsolatesConfig, SERVICE } from "../../src/config.ts";
import { imageDeployment } from "../../src/deployments.ts";
import { IsolatesStack } from "../lib/isolates-stack.ts";

type Resource = { Type: string; Properties?: Record<string, unknown>; DeletionPolicy?: string };
type Statement = { Effect: string; Action: string | string[]; Resource: unknown };

function synth(input: unknown) {
  const app = new App();
  const stack = new IsolatesStack(app, "AihIsolates", {
    env: { region: "ap-northeast-1" },
    config: parseIsolatesConfig(input),
  });
  const template = Template.fromStack(stack);
  const resources = template.toJSON()["Resources"] as Record<string, Resource>;
  const ofType = (type: string): [string, Resource][] =>
    Object.entries(resources).filter(([, resource]) => resource.Type === type);
  return { template, resources, ofType, missing: app.synth().manifest.missing };
}

const repositoryOnly = synth({});
const deployed = synth({ imageTag: "v1" });
const inPrivate = synth({ imageTag: "v1", taskSubnets: "private" });

const container = (layout: typeof deployed): Record<string, unknown> => {
  const [[, task] = []] = layout.ofType("AWS::ECS::TaskDefinition");
  const [first] = (task?.Properties?.["ContainerDefinitions"] ?? []) as Record<string, unknown>[];
  return first ?? {};
};

describe("IsolatesStack without an image tag", () => {
  it("is the repository alone, with nothing billed by the hour", () => {
    expect(Object.values(repositoryOnly.resources).map((resource) => resource.Type)).toEqual([
      "AWS::ECR::Repository",
    ]);
  });

  it("never lets a tag point at a different image, and keeps the repository private", () => {
    const [[, repository] = []] = repositoryOnly.ofType("AWS::ECR::Repository");
    expect(repository?.Properties?.["ImageTagMutability"]).toBe("IMMUTABLE");
    expect(repository?.Properties).not.toHaveProperty("RepositoryPolicyText");
  });
});

describe("IsolatesStack with an image tag", () => {
  const { template, resources, ofType } = deployed;

  it("gives the workers no permission at all, and the agent only the pull and the log stream", () => {
    const policies = ofType("AWS::IAM::Policy");
    expect(policies).toHaveLength(1);
    const [[, policy] = []] = policies;
    const [[executionRoleId] = []] = ofType("AWS::IAM::Role").filter(([id]) =>
      id.startsWith("ExecutionRole"),
    );
    expect(policy?.Properties?.["Roles"]).toEqual([{ Ref: executionRoleId }]);

    const document = policy?.Properties?.["PolicyDocument"] as
      | { Statement: Statement[] }
      | undefined;
    const statements = document?.Statement ?? [];
    expect(statements.flatMap((statement) => statement.Action).toSorted()).toEqual([
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetAuthorizationToken",
      "ecr:GetDownloadUrlForLayer",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    // ecr:GetAuthorizationToken has no resource to name; it is the one "*" in the stack.
    const wildcards = statements.filter(
      (statement) => JSON.stringify(statement.Resource) === '"*"',
    );
    expect(wildcards.map((statement) => statement.Action)).toEqual(["ecr:GetAuthorizationToken"]);
    for (const [, role] of ofType("AWS::IAM::Role")) {
      expect(role.Properties).not.toHaveProperty("ManagedPolicyArns");
      expect(role.Properties).not.toHaveProperty("Policies");
    }
  });

  it("runs one arm64 task with the tag it was given, on a root file system it cannot write", () => {
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      RuntimePlatform: { CpuArchitecture: "ARM64", OperatingSystemFamily: "LINUX" },
      Cpu: "256",
      Memory: "512",
    });
    expect(JSON.stringify(container(deployed)["Image"])).toContain(':v1"');
    expect(container(deployed)).toMatchObject({
      ReadonlyRootFilesystem: true,
      StopTimeout: timing.stopTimeout,
    });
    expect(container(deployed)).not.toHaveProperty("Secrets");
    template.hasResourceProperties("AWS::ECS::Service", { DesiredCount: SERVICE.desiredCount });
  });

  // #region bindings
  it("sets every environment variable the image's configuration turns into a binding", () => {
    const set = (container(deployed)["Environment"] as { Name: string }[]).map(
      (entry) => entry.Name,
    );
    const read = imageDeployment.workers.flatMap((worker) =>
      worker.bindings.flatMap((binding) =>
        binding.from === "environment" ? [binding.variable] : [],
      ),
    );
    expect(set.toSorted()).toEqual(read.toSorted());
  });

  it("maps the port the image's configuration listens on", () => {
    const [socket] = imageDeployment.sockets;
    expect(container(deployed)["PortMappings"]).toEqual([
      expect.objectContaining({ ContainerPort: Number(socket?.address.split(":")[1]) }),
    ]);
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      Port: Number(socket?.address.split(":")[1]),
      HealthCheckPath: "/health",
      Matcher: { HttpCode: "200" },
    });
  });
  // #endregion bindings

  it("opens the tasks to the load balancer only, and the load balancer on port 80 only", () => {
    const ingress = ofType("AWS::EC2::SecurityGroupIngress").map(([, rule]) => rule.Properties);
    expect(ingress).toEqual([
      expect.objectContaining({
        IpProtocol: "tcp",
        FromPort: 8080,
        ToPort: 8080,
        GroupId: { "Fn::GetAtt": [expect.stringMatching(/^TaskGroup/), "GroupId"] },
        SourceSecurityGroupId: {
          "Fn::GetAtt": [expect.stringMatching(/^LoadBalancerGroup/), "GroupId"],
        },
      }),
    ]);
    const group = (prefix: string) =>
      ofType("AWS::EC2::SecurityGroup").find(([id]) => id.startsWith(prefix))?.[1].Properties;
    expect(group("TaskGroup")).not.toHaveProperty("SecurityGroupIngress");
    expect(group("TaskGroup")?.["SecurityGroupEgress"]).toEqual([
      expect.objectContaining({ IpProtocol: "tcp", FromPort: 443, ToPort: 443 }),
    ]);
    expect(group("LoadBalancerGroup")?.["SecurityGroupIngress"]).toEqual([
      expect.objectContaining({ CidrIp: "0.0.0.0/0", IpProtocol: "tcp", FromPort: 80, ToPort: 80 }),
    ]);
    template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 1);
  });

  it("replaces the task without a gap, and rolls back by itself", () => {
    template.hasResourceProperties("AWS::ECS::Service", {
      DeploymentConfiguration: {
        MinimumHealthyPercent: 100,
        MaximumPercent: 200,
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      },
      HealthCheckGracePeriodSeconds: timing.healthCheckGrace,
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      TargetGroupAttributes: Match.arrayWith([
        { Key: "deregistration_delay.timeout_seconds", Value: String(timing.deregistrationDelay) },
      ]),
    });
  });

  it("expires logs after a week, and leaves nothing behind when the stack is destroyed", () => {
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 7 },
      DeletionPolicy: "Delete",
    });
    template.hasResource("AWS::ECR::Repository", {
      Properties: { EmptyOnDelete: true },
      DeletionPolicy: "Delete",
    });
    for (const [id, resource] of Object.entries(resources)) {
      expect(resource.DeletionPolicy ?? "Delete", id).toBe("Delete");
    }
  });

  it("puts the tasks in private subnets without an address when asked to", () => {
    const network = (layout: typeof deployed) => {
      const [[, service] = []] = layout.ofType("AWS::ECS::Service");
      const configuration = service?.Properties?.["NetworkConfiguration"] as
        | { AwsvpcConfiguration: Record<string, unknown> }
        | undefined;
      return configuration?.AwsvpcConfiguration;
    };
    expect(network(deployed)).toMatchObject({ AssignPublicIp: "ENABLED" });
    expect(network(inPrivate)).toMatchObject({
      AssignPublicIp: "DISABLED",
      Subnets: [
        { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
        { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
      ],
    });
  });

  it("asks AWS nothing during synthesis, and names no account", () => {
    expect(deployed.missing).toBeUndefined();
    expect(/:\d{12}:/.test(JSON.stringify(resources))).toBe(false);
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    // From the handledProperties tables of the providers registered in
    // src/provisioning/register-providers.ts at v0.296.28. A property outside
    // these lists would send the whole resource through Cloud Control.
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
      "AWS::ECS::Cluster": [],
      "AWS::ECS::Service": [
        "Cluster",
        "DeploymentConfiguration",
        "DeploymentController",
        "DesiredCount",
        "EnableECSManagedTags",
        "HealthCheckGracePeriodSeconds",
        "LaunchType",
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
    };
    // No provider of its own in that file, and not on cdkd's unsupported list: Cloud Control.
    const viaCloudControl = ["AWS::EC2::SecurityGroupEgress"];

    const types = [
      ...new Set(Object.values(resources).map((resource) => resource.Type)),
    ].toSorted();
    expect(types).toEqual([...Object.keys(handled), ...viaCloudControl].toSorted());
    for (const [id, resource] of Object.entries(resources)) {
      const allowed = handled[resource.Type];
      if (allowed !== undefined) {
        expect(allowed, id).toEqual(expect.arrayContaining(Object.keys(resource.Properties ?? {})));
      }
    }
  });
});
