import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { describe, expect, it } from "vite-plus/test";

import {
  openLoadBalancer,
  prefixListLoadBalancer,
  privateLoadBalancer,
} from "../infra/lib/alb-origin.ts";
import { checkOrigins, type Exposure, notClosed } from "../src/origins.ts";

// The templates are CDK's own output, so the check is tried on the shapes it will meet.
const synth = (build: (stack: Stack) => void): unknown => {
  const stack = new Stack(new App(), "Fixture", { env: { region: "ap-northeast-1" } });
  build(stack);
  return Template.fromStack(stack).toJSON();
};

const vpcOf = (stack: Stack) =>
  new ec2.Vpc(stack, "Vpc", {
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
      { name: "public", subnetType: ec2.SubnetType.PUBLIC },
      { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    ],
  });

const functionOf = (stack: Stack) =>
  new lambda.Function(stack, "Fn", {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("export const handler = async () => ({ statusCode: 200 });"),
  });

const front = (stack: Stack, origin: cloudfront.IOrigin) =>
  new cloudfront.Distribution(stack, "Distribution", { defaultBehavior: { origin } });

const exposures = (template: unknown, type: string): Exposure[] =>
  checkOrigins(template)
    .filter((finding) => finding.type === type)
    .map((finding) => finding.exposure);

const URL = "AWS::Lambda::Url";
const ALB = "AWS::ElasticLoadBalancingV2::LoadBalancer";

describe("a function URL", () => {
  it("is closed when only a named distribution may sign for it", () => {
    const template = synth((stack) => {
      const url = functionOf(stack).addFunctionUrl({
        authType: lambda.FunctionUrlAuthType.AWS_IAM,
      });
      front(stack, origins.FunctionUrlOrigin.withOriginAccessControl(url));
    });
    expect(exposures(template, URL)).toEqual(["closed"]);
    expect(notClosed(checkOrigins(template))).toEqual([]);
  });

  it("can be walked around when it takes unsigned requests behind a distribution", () => {
    const template = synth((stack) => {
      const url = functionOf(stack).addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
      front(stack, new origins.FunctionUrlOrigin(url));
    });
    expect(exposures(template, URL)).toEqual(["bypassable"]);
  });

  it("is on the internet by itself when nothing is in front", () => {
    const template = synth((stack) => {
      functionOf(stack).addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    });
    expect(exposures(template, URL)).toEqual(["direct"]);
  });

  it.each([
    ["the function", { "Fn::GetAtt": ["Fn", "Arn"] }],
    ["the URL, as CDK writes it", { "Fn::GetAtt": ["Url", "FunctionArn"] }],
  ])("is open to every distribution of every account without SourceArn: %s", (_name, target) => {
    const template = {
      Resources: {
        Fn: { Type: "AWS::Lambda::Function", Properties: {} },
        Url: {
          Type: URL,
          Properties: { AuthType: "AWS_IAM", TargetFunctionArn: { "Fn::GetAtt": ["Fn", "Arn"] } },
        },
        Allow: {
          Type: "AWS::Lambda::Permission",
          Properties: {
            Action: "lambda:InvokeFunctionUrl",
            FunctionName: target,
            Principal: "cloudfront.amazonaws.com",
          },
        },
      },
    };
    const [finding] = checkOrigins(template);
    expect(finding?.exposure).toBe("direct");
    expect(finding?.reason).toContain("SourceArn");
  });

  it("is not vouched for when the auth type is decided at deploy time", () => {
    const template = {
      Resources: {
        Url: { Type: URL, Properties: { AuthType: { Ref: "AuthTypeParameter" } } },
      },
    };
    expect(exposures(template, URL)).toEqual(["unknown"]);
  });
});

describe("a load balancer", () => {
  it("can be walked around when it is on the internet and admits everyone", () => {
    const template = synth((stack) => front(stack, openLoadBalancer(stack, vpcOf(stack))));
    expect(exposures(template, ALB)).toEqual(["bypassable"]);
  });

  it("is closed when its security group admits only a prefix list", () => {
    const template = synth((stack) =>
      front(stack, prefixListLoadBalancer(stack, vpcOf(stack), "pl-0123456789abcdef0")),
    );
    expect(exposures(template, ALB)).toEqual(["closed"]);
  });

  it("is closed when it has no public address and CloudFront uses a VPC origin", () => {
    const template = synth((stack) => front(stack, privateLoadBalancer(stack, vpcOf(stack))));
    expect(exposures(template, ALB)).toEqual(["closed"]);
  });

  it("is not vouched for when its security group is defined elsewhere", () => {
    const template = {
      Resources: {
        Alb: { Type: ALB, Properties: { SecurityGroups: ["sg-0123456789abcdef0"] } },
      },
    };
    expect(exposures(template, ALB)).toEqual(["unknown"]);
  });

  it("is not vouched for when a CIDR narrower than everyone is admitted", () => {
    const template = {
      Resources: {
        Group: {
          Type: "AWS::EC2::SecurityGroup",
          Properties: { SecurityGroupIngress: [{ CidrIp: "203.0.113.0/24", IpProtocol: "tcp" }] },
        },
        Alb: {
          Type: ALB,
          Properties: { SecurityGroups: [{ "Fn::GetAtt": ["Group", "GroupId"] }] },
        },
      },
    };
    expect(exposures(template, ALB)).toEqual(["unknown"]);
  });

  it("reads a rule that stands apart from its security group", () => {
    const template = {
      Resources: {
        Group: { Type: "AWS::EC2::SecurityGroup", Properties: {} },
        Rule: {
          Type: "AWS::EC2::SecurityGroupIngress",
          Properties: { GroupId: { "Fn::GetAtt": ["Group", "GroupId"] }, CidrIpv6: "::/0" },
        },
        Alb: {
          Type: ALB,
          Properties: { SecurityGroups: [{ "Fn::GetAtt": ["Group", "GroupId"] }] },
        },
      },
    };
    expect(exposures(template, ALB)).toEqual(["direct"]);
  });
});

describe("an API Gateway API", () => {
  it("is on the internet whatever is put in front of it", () => {
    const template = synth((stack) => {
      new apigwv2.HttpApi(stack, "Api");
    });
    expect(exposures(template, "AWS::ApiGatewayV2::Api")).toEqual(["direct"]);
  });

  it("is closed only as a private REST API", () => {
    const rest = (types: string[]) => ({
      Resources: {
        Api: {
          Type: "AWS::ApiGateway::RestApi",
          Properties: { EndpointConfiguration: { Types: types } },
        },
      },
    });
    expect(exposures(rest(["PRIVATE"]), "AWS::ApiGateway::RestApi")).toEqual(["closed"]);
    expect(exposures(rest(["REGIONAL"]), "AWS::ApiGateway::RestApi")).toEqual(["direct"]);
  });
});

describe("the check itself", () => {
  it("refuses what is not a template, instead of passing it", () => {
    expect(() => checkOrigins({})).toThrow();
    expect(() => checkOrigins("Resources")).toThrow();
  });

  it("has nothing to say about a template without an origin", () => {
    expect(checkOrigins({ Resources: { Topic: { Type: "AWS::SNS::Topic" } } })).toEqual([]);
  });
});
