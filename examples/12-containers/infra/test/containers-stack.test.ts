import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { parseContainersConfig, SERVICE } from "../../src/config.ts";
import { timing } from "../../src/timing.ts";
import { ContainersStack } from "../lib/containers-stack.ts";

type Resource = { Type: string; Properties?: Record<string, unknown>; DeletionPolicy?: string };
type Statement = { Effect: string; Action: string | string[]; Resource: unknown };

// Each layout is synthesized once, outside the tests: the first synthesis of a file is the slow one.
function synth(input: unknown) {
  const app = new App();
  const stack = new ContainersStack(app, "AihContainers", {
    env: { region: "ap-northeast-1" },
    config: parseContainersConfig(input),
  });
  const template = Template.fromStack(stack);
  const resources = template.toJSON()["Resources"] as Record<string, Resource>;
  const ofType = (type: string): [string, Resource][] =>
    Object.entries(resources).filter(([, resource]) => resource.Type === type);
  return { template, resources, ofType, missing: app.synth().manifest.missing };
}

const repositoryOnly = synth({});
const inPublic = synth({ imageTag: "v1" });
const inPrivate = synth({ imageTag: "v1", taskSubnets: "private" });

const HOURLY_TYPES = ["AWS::ECS::Service", "AWS::ElasticLoadBalancingV2::LoadBalancer"];

describe("ContainersStack without an image tag", () => {
  it("is the repository alone, with nothing billed by the hour", () => {
    expect(Object.values(repositoryOnly.resources).map((resource) => resource.Type)).toEqual(["AWS::ECR::Repository"]);
  });

  it("never lets a tag point at a different image, and keeps old images from piling up", () => {
    const [[, repository] = []] = repositoryOnly.ofType("AWS::ECR::Repository");
    expect(repository?.Properties?.["ImageTagMutability"]).toBe("IMMUTABLE");
    const policy = repository?.Properties?.["LifecyclePolicy"] as { LifecyclePolicyText: string };
    expect(JSON.parse(policy.LifecyclePolicyText).rules).toEqual([
      expect.objectContaining({ selection: { tagStatus: "any", countType: "imageCountMoreThan", countNumber: 10 } }),
    ]);
  });

  it("keeps the repository private: no policy opens it to anyone", () => {
    const [[, repository] = []] = repositoryOnly.ofType("AWS::ECR::Repository");
    expect(repository?.Properties).not.toHaveProperty("RepositoryPolicyText");
    expect(repositoryOnly.ofType("AWS::ECR::PublicRepository")).toEqual([]);
  });
});

describe("ContainersStack with an image tag", () => {
  const { template, resources, ofType } = inPublic;

  it("gives the code no permission at all, and the agent only the pull and the log stream", () => {
    const policies = ofType("AWS::IAM::Policy");
    expect(policies).toHaveLength(1);
    const [[, policy] = []] = policies;
    const [[executionRoleId] = []] = ofType("AWS::IAM::Role").filter(([id]) => id.startsWith("ExecutionRole"));
    expect(policy?.Properties?.["Roles"]).toEqual([{ Ref: executionRoleId }]);

    const document = policy?.Properties?.["PolicyDocument"] as { Statement: Statement[] } | undefined;
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
    const wildcards = statements.filter((statement) => JSON.stringify(statement.Resource) === '"*"');
    expect(wildcards.map((statement) => statement.Action)).toEqual(["ecr:GetAuthorizationToken"]);

    // Neither role carries a managed or inline policy, so the task role has nothing.
    for (const [, role] of ofType("AWS::IAM::Role")) {
      expect(role.Properties).not.toHaveProperty("ManagedPolicyArns");
      expect(role.Properties).not.toHaveProperty("Policies");
    }
  });

  it("passes the two roles to the task under the right names", () => {
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ExecutionRoleArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^ExecutionRole"), "Arn"] },
      TaskRoleArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^TaskRole"), "Arn"] },
      RuntimePlatform: { CpuArchitecture: "ARM64", OperatingSystemFamily: "LINUX" },
      Cpu: "256",
      Memory: "512",
    });
  });

  it("runs the tag it was given, and tells the app which one that is", () => {
    const [[, task] = []] = ofType("AWS::ECS::TaskDefinition");
    const [container] = (task?.Properties?.["ContainerDefinitions"] ?? []) as Record<string, unknown>[];
    expect(JSON.stringify(container?.["Image"])).toContain(':v1"');
    expect(container?.["Environment"]).toEqual(expect.arrayContaining([{ Name: "APP_VERSION", Value: "v1" }]));
    expect(container).toMatchObject({ ReadonlyRootFilesystem: true, StopTimeout: timing.stopTimeout });
    // No secret belongs in a plain environment variable.
    expect(container).not.toHaveProperty("Secrets");
  });

  it("opens the tasks to the load balancer only", () => {
    const ingress = ofType("AWS::EC2::SecurityGroupIngress").map(([, rule]) => rule.Properties);
    expect(ingress).toEqual([
      {
        Description: "Load balancer to target",
        IpProtocol: "tcp",
        FromPort: 8080,
        ToPort: 8080,
        GroupId: { "Fn::GetAtt": [expect.stringMatching(/^TaskGroup/), "GroupId"] },
        SourceSecurityGroupId: { "Fn::GetAtt": [expect.stringMatching(/^LoadBalancerGroup/), "GroupId"] },
      },
    ]);
    // The task's own group has no inline ingress: a public IP address alone lets nobody in.
    const [[, taskGroup] = []] = ofType("AWS::EC2::SecurityGroup").filter(([id]) => id.startsWith("TaskGroup"));
    expect(taskGroup?.Properties).not.toHaveProperty("SecurityGroupIngress");
    expect(taskGroup?.Properties?.["SecurityGroupEgress"]).toEqual([
      expect.objectContaining({ IpProtocol: "tcp", FromPort: 443, ToPort: 443 }),
    ]);
  });

  it("exposes port 80 of the load balancer to the internet, and nothing else", () => {
    const [[, group] = []] = ofType("AWS::EC2::SecurityGroup").filter(([id]) => id.startsWith("LoadBalancerGroup"));
    expect(group?.Properties?.["SecurityGroupIngress"]).toEqual([
      expect.objectContaining({ CidrIp: "0.0.0.0/0", IpProtocol: "tcp", FromPort: 80, ToPort: 80 }),
    ]);
    template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 1);
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", { Scheme: "internet-facing" });
  });

  it("replaces tasks without dropping below the desired count, and rolls back by itself", () => {
    template.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: SERVICE.desiredCount,
      DeploymentController: { Type: "ECS" },
      DeploymentConfiguration: {
        MinimumHealthyPercent: 100,
        MaximumPercent: 200,
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      },
    });
  });

  it("puts the same durations in the template that the server runs with", () => {
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      TargetType: "ip",
      HealthCheckPath: "/health",
      Matcher: { HttpCode: "200" },
      HealthCheckIntervalSeconds: timing.healthCheckInterval,
      HealthCheckTimeoutSeconds: timing.healthCheckTimeout,
      HealthyThresholdCount: timing.healthyThreshold,
      UnhealthyThresholdCount: timing.unhealthyThreshold,
      TargetGroupAttributes: Match.arrayWith([
        { Key: "deregistration_delay.timeout_seconds", Value: String(timing.deregistrationDelay) },
      ]),
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      LoadBalancerAttributes: Match.arrayWith([
        { Key: "idle_timeout.timeout_seconds", Value: String(timing.albIdleTimeout) },
      ]),
    });
    template.hasResourceProperties("AWS::ECS::Service", { HealthCheckGracePeriodSeconds: timing.healthCheckGrace });
  });

  it("caps auto scaling, and with it the bill", () => {
    template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalableTarget", {
      MinCapacity: SERVICE.desiredCount,
      MaxCapacity: SERVICE.maxCount,
      ScalableDimension: "ecs:service:DesiredCount",
    });
    template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalingPolicy", {
      PolicyType: "TargetTrackingScaling",
      TargetTrackingScalingPolicyConfiguration: {
        PredefinedMetricSpecification: { PredefinedMetricType: "ECSServiceAverageCPUUtilization" },
        TargetValue: SERVICE.targetCpuPercent,
      },
    });
  });

  it("expires logs after a week, and leaves nothing behind when the stack is destroyed", () => {
    template.hasResource("AWS::Logs::LogGroup", { Properties: { RetentionInDays: 7 }, DeletionPolicy: "Delete" });
    template.hasResource("AWS::ECR::Repository", { Properties: { EmptyOnDelete: true }, DeletionPolicy: "Delete" });
    for (const [id, resource] of Object.entries(resources)) {
      expect(resource.DeletionPolicy ?? "Delete", id).toBe("Delete");
    }
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      LoadBalancerAttributes: Match.arrayWith([{ Key: "deletion_protection.enabled", Value: "false" }]),
    });
  });

  it("asks AWS nothing during synthesis, and names no account", () => {
    expect(inPublic.missing).toBeUndefined();
    // An account ID would show up as the fifth field of an ARN.
    expect(/:\d{12}:/.test(JSON.stringify(resources))).toBe(false);
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    // From the handledProperties tables of the providers registered in
    // src/provisioning/register-providers.ts at v0.296.28. A property outside
    // these lists would send the whole resource through Cloud Control.
    const handled: Record<string, string[]> = {
      "AWS::EC2::SecurityGroup": ["GroupDescription", "SecurityGroupEgress", "SecurityGroupIngress", "VpcId"],
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
      "AWS::ElasticLoadBalancingV2::Listener": ["DefaultActions", "LoadBalancerArn", "Port", "Protocol"],
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
    const viaCloudControl = [
      "AWS::ApplicationAutoScaling::ScalableTarget",
      "AWS::ApplicationAutoScaling::ScalingPolicy",
      "AWS::EC2::SecurityGroupEgress",
    ];

    const types = [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
    expect(types).toEqual([...Object.keys(handled), ...viaCloudControl].toSorted());
    for (const [id, resource] of Object.entries(resources)) {
      const allowed = handled[resource.Type];
      if (allowed !== undefined) {
        expect(allowed, id).toEqual(expect.arrayContaining(Object.keys(resource.Properties ?? {})));
      }
    }
  });
});

describe("where the tasks live", () => {
  const network = (layout: typeof inPublic) => {
    const [[, service] = []] = layout.ofType("AWS::ECS::Service");
    const configuration = service?.Properties?.["NetworkConfiguration"] as
      | { AwsvpcConfiguration: Record<string, unknown> }
      | undefined;
    return configuration?.AwsvpcConfiguration;
  };

  it("by default: public subnets, each task with an address of its own", () => {
    expect(network(inPublic)).toMatchObject({
      AssignPublicIp: "ENABLED",
      Subnets: [
        { "Fn::ImportValue": "AihNetwork-Public1SubnetId" },
        { "Fn::ImportValue": "AihNetwork-Public2SubnetId" },
      ],
    });
  });

  it("with taskSubnets=private: private subnets, no public address, same firewall", () => {
    expect(network(inPrivate)).toMatchObject({
      AssignPublicIp: "DISABLED",
      Subnets: [
        { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
        { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
      ],
    });
    expect(inPrivate.ofType("AWS::EC2::SecurityGroupIngress")).toEqual(
      inPublic.ofType("AWS::EC2::SecurityGroupIngress"),
    );
  });

  it("keeps the load balancer in the public subnets either way", () => {
    for (const layout of [inPublic, inPrivate]) {
      layout.template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
        Subnets: [
          { "Fn::ImportValue": "AihNetwork-Public1SubnetId" },
          { "Fn::ImportValue": "AihNetwork-Public2SubnetId" },
        ],
      });
    }
  });

  it("creates the hourly resources only when an image tag is given", () => {
    for (const type of HOURLY_TYPES) {
      expect(repositoryOnly.ofType(type)).toEqual([]);
      expect(inPublic.ofType(type)).toHaveLength(1);
    }
  });
});
