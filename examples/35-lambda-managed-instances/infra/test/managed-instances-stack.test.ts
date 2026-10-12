import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { parseManagedConfig } from "../../src/config.ts";
import { ManagedInstancesStack } from "../lib/managed-instances-stack.ts";

type Resource = { Type: string; Properties: Record<string, unknown>; DeletionPolicy?: string };
type Statement = { Effect: string; Action: string | string[]; Resource: unknown };

function synth(input: unknown = {}) {
  const stack = new ManagedInstancesStack(new App(), "AihManagedInstances", {
    env: { region: "ap-northeast-1" },
    config: parseManagedConfig(input),
  });
  const template = Template.fromStack(stack);
  const resources = template.toJSON()["Resources"] as Record<string, Resource>;
  const only = (type: string): Record<string, unknown> => {
    const found = Object.values(resources).filter((resource) => resource.Type === type);
    if (found.length !== 1 || found[0] === undefined) {
      throw new Error(`expected one ${type}, found ${found.length}`);
    }
    return found[0].Properties;
  };
  return { template, resources, only };
}

// Synthesis bundles the handler with esbuild, so it runs once per configuration.
const { template, resources, only } = synth();

describe("ManagedInstancesStack, the capacity provider", () => {
  const provider = only("AWS::Lambda::CapacityProvider");

  it("puts the instances in the private subnets of the chapter 11 VPC, one per zone", () => {
    expect(provider["VpcConfig"]).toEqual({
      SubnetIds: [
        { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
        { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
      ],
      SecurityGroupIds: [
        { "Fn::GetAtt": [expect.stringMatching(/^InstanceSecurityGroup/), "GroupId"] },
      ],
    });
  });

  it("opens no inbound port, and lets the instances open HTTPS connections and nothing else", () => {
    const group = only("AWS::EC2::SecurityGroup");
    expect(group["SecurityGroupIngress"]).toBeUndefined();
    template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 0);
    expect(group["SecurityGroupEgress"]).toEqual([
      {
        IpProtocol: "tcp",
        FromPort: 443,
        ToPort: 443,
        CidrIp: "0.0.0.0/0",
        Description: "HTTPS to AWS APIs",
      },
    ]);
  });

  it("caps what Lambda may launch: one instance type, 12 vCPUs", () => {
    expect(provider["InstanceRequirements"]).toEqual({
      Architectures: ["arm64"],
      AllowedInstanceTypes: ["m6g.large"],
    });
    expect(provider["CapacityProviderScalingConfig"]).toEqual({
      ScalingMode: "Auto",
      MaxVCpuCount: 12,
    });
  });

  it("gives Lambda an operator role with the policy its guide names, and nothing added", () => {
    const roles = Object.values(resources).filter((resource) => resource.Type === "AWS::IAM::Role");
    const operator = roles.filter((role) => role.Properties["ManagedPolicyArns"] !== undefined);
    expect(operator).toHaveLength(1);
    expect(JSON.stringify(operator[0]?.Properties["ManagedPolicyArns"])).toContain(
      ":iam::aws:policy/AWSLambdaManagedEC2ResourceOperator",
    );
    expect(operator[0]?.Properties["AssumeRolePolicyDocument"]).toMatchObject({
      Statement: [{ Action: "sts:AssumeRole", Principal: { Service: "lambda.amazonaws.com" } }],
    });
    expect(provider["PermissionsConfig"]).toEqual({
      CapacityProviderOperatorRoleArn: {
        "Fn::GetAtt": [expect.stringMatching(/^OperatorRole/), "Arn"],
      },
    });
  });

  it("sends its system logs to a group that expires and goes with the stack", () => {
    expect(provider["TelemetryConfig"]).toEqual({
      LoggingConfig: { LogGroup: { Ref: expect.stringMatching(/^CapacityProviderLogs/) } },
    });
    const groups = Object.values(resources).filter((item) => item.Type === "AWS::Logs::LogGroup");
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.Properties["RetentionInDays"]).toBe(7);
      expect(group.DeletionPolicy).toBe("Delete");
    }
  });
});

describe("ManagedInstancesStack, the function", () => {
  const handler = only("AWS::Lambda::Function");

  it("runs on the capacity provider, at the smallest size Managed Instances takes", () => {
    expect(handler).toMatchObject({
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      MemorySize: 2048,
      CapacityProviderConfig: {
        LambdaManagedInstancesCapacityProviderConfig: {
          CapacityProviderArn: {
            "Fn::GetAtt": [expect.stringMatching(/^CapacityProvider/), "Arn"],
          },
        },
      },
    });
    // No VpcConfig of its own: the capacity provider is what places it in the VPC.
    expect(handler["VpcConfig"]).toBeUndefined();
  });

  it("keeps three execution environments when idle and stops at six", () => {
    expect(handler["FunctionScalingConfig"]).toEqual({
      MinExecutionEnvironments: 3,
      MaxExecutionEnvironments: 6,
    });
  });

  it("can be switched off without deleting anything", () => {
    const off = synth({ minExecutionEnvironments: 0, maxExecutionEnvironments: 0 });
    expect(off.only("AWS::Lambda::Function")["FunctionScalingConfig"]).toEqual({
      MinExecutionEnvironments: 0,
      MaxExecutionEnvironments: 0,
    });
  });

  it("gives the function no permission beyond writing its own log group", () => {
    const statements = Object.values(resources)
      .filter((resource) => resource.Type === "AWS::IAM::Policy")
      .flatMap(
        (policy) => (policy.Properties["PolicyDocument"] as { Statement: Statement[] }).Statement,
      );
    expect(statements.flatMap((statement) => statement.Action).toSorted()).toEqual([
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
    }
  });

  it("stops waiting before API Gateway does", () => {
    expect(handler["Timeout"]).toBeLessThan(30);
  });
});

describe("ManagedInstancesStack, the API", () => {
  it("exposes exactly the routes the application implements", () => {
    const routes = Object.values(resources)
      .filter((resource) => resource.Type === "AWS::ApiGatewayV2::Route")
      .map((route) => route.Properties["RouteKey"] as string)
      .toSorted();
    expect(routes).toEqual([
      "DELETE /notes/{id}",
      "GET /health",
      "GET /notes",
      "GET /notes/{id}",
      "POST /notes",
    ]);
  });

  it("invokes the unqualified function, which Managed Instances resolves to the published version", () => {
    const integrations = Object.values(resources).filter(
      (resource) => resource.Type === "AWS::ApiGatewayV2::Integration",
    );
    expect(integrations.length).toBeGreaterThan(0);
    for (const integration of integrations) {
      expect(integration.Properties["IntegrationUri"]).toEqual({
        "Fn::GetAtt": [expect.stringMatching(/^Handler/), "Arn"],
      });
    }
  });

  it("throttles at the stage, as chapter 04 does", () => {
    expect(only("AWS::ApiGatewayV2::Stage")["DefaultRouteSettings"]).toEqual({
      ThrottlingRateLimit: 10,
      ThrottlingBurstLimit: 20,
    });
  });
});

describe("ManagedInstancesStack, as a whole", () => {
  // #region resource-types
  // AWS::Lambda::CapacityProvider has no provider of its own in cdkd 0.296.28 and goes through
  // Cloud Control API. So does this AWS::Lambda::Function: cdkd's Lambda provider does not write
  // CapacityProviderConfig or FunctionScalingConfig, and routes a function that has them the same way.
  it("uses only resource types that were checked against the pinned cdkd", () => {
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      "AWS::EC2::SecurityGroup",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::CapacityProvider",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
    ]);
  });
  // #endregion resource-types

  it("names no account, and asks AWS nothing during synthesis", () => {
    expect(JSON.stringify(resources)).not.toMatch(/\d{12}/);
    expect(Object.keys(template.toJSON()["Parameters"] as object)).toEqual(["BootstrapVersion"]);
  });

  it("retains nothing after the stack is destroyed", () => {
    for (const resource of Object.values(resources)) {
      expect(resource.DeletionPolicy ?? "Delete").toBe("Delete");
    }
  });
});
