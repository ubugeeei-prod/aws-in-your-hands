import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { parseNetworkConfig } from "../../src/config.ts";
import { planNetwork } from "../../src/plan.ts";
import { NetworkStack } from "../lib/network-stack.ts";

type Resource = { Type: string; Properties?: Record<string, unknown>; DeletionPolicy?: string };

function synth(input: unknown = {}) {
  const app = new App();
  const stack = new NetworkStack(app, "AihNetwork", {
    env: { region: "ap-northeast-1" },
    plan: planNetwork(parseNetworkConfig(input)),
  });
  const template = Template.fromStack(stack);
  const json = template.toJSON() as {
    Resources: Record<string, Resource>;
    Outputs: Record<string, { Value: unknown; Export?: { Name: string } }>;
  };
  const ofType = (type: string): [string, Resource][] =>
    Object.entries(json.Resources).filter(([, resource]) => resource.Type === type);
  const types = [...new Set(Object.values(json.Resources).map((resource) => resource.Type))].toSorted();
  return { app, template, json, ofType, types };
}

const privateRouteTables = [{ Ref: "Private1RouteTable" }, { Ref: "Private2RouteTable" }];
const privateSubnets = [{ Ref: "Private1Subnet" }, { Ref: "Private2Subnet" }];

describe("NetworkStack, default layout", () => {
  const { app, template, json, ofType, types } = synth();

  it("creates no NAT gateway, no Elastic IP address, and no interface endpoint", () => {
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
    template.resourceCountIs("AWS::EC2::EIP", 0);
    template.resourceCountIs("AWS::EC2::SecurityGroup", 0);
    for (const [, endpoint] of ofType("AWS::EC2::VPCEndpoint")) {
      expect(endpoint.Properties?.["VpcEndpointType"]).toBe("Gateway");
    }
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    expect(types).toEqual([
      "AWS::EC2::InternetGateway",
      "AWS::EC2::Route",
      "AWS::EC2::RouteTable",
      "AWS::EC2::Subnet",
      "AWS::EC2::SubnetRouteTableAssociation",
      "AWS::EC2::VPC",
      "AWS::EC2::VPCEndpoint",
      "AWS::EC2::VPCGatewayAttachment",
    ]);
  });

  it("routes to the internet from the public route tables only", () => {
    const routes = ofType("AWS::EC2::Route").map(([, route]) => route.Properties);
    expect(routes).toEqual([
      {
        RouteTableId: { Ref: "Public1RouteTable" },
        DestinationCidrBlock: "0.0.0.0/0",
        GatewayId: { Ref: "InternetGateway" },
      },
      {
        RouteTableId: { Ref: "Public2RouteTable" },
        DestinationCidrBlock: "0.0.0.0/0",
        GatewayId: { Ref: "InternetGateway" },
      },
    ]);
  });

  it("gives every subnet its own route table, in the planned zone and range", () => {
    expect(ofType("AWS::EC2::Subnet").map(([id, subnet]) => [id, subnet.Properties])).toEqual(
      [
        ["Public1", "ap-northeast-1a", "10.20.0.0/20"],
        ["Public2", "ap-northeast-1c", "10.20.16.0/20"],
        ["Private1", "ap-northeast-1a", "10.20.128.0/20"],
        ["Private2", "ap-northeast-1c", "10.20.144.0/20"],
      ].map(([name, zone, cidr]) => [
        `${name}Subnet`,
        {
          VpcId: { Ref: "Vpc" },
          AvailabilityZone: zone,
          CidrBlock: cidr,
          MapPublicIpOnLaunch: false,
          Tags: [{ Key: "Name", Value: `AihNetwork/${name}` }],
        },
      ]),
    );
    expect(
      ofType("AWS::EC2::SubnetRouteTableAssociation")
        .map(([, association]) => association.Properties)
        .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual(
      ["Private1", "Private2", "Public1", "Public2"].map((name) => ({
        RouteTableId: { Ref: `${name}RouteTable` },
        SubnetId: { Ref: `${name}Subnet` },
      })),
    );
  });

  it("attaches the S3 and DynamoDB gateway endpoints to the private route tables only", () => {
    expect(ofType("AWS::EC2::VPCEndpoint").map(([, endpoint]) => endpoint.Properties)).toEqual(
      ["s3", "dynamodb"].map((service) => ({
        VpcEndpointType: "Gateway",
        ServiceName: `com.amazonaws.ap-northeast-1.${service}`,
        VpcId: { Ref: "Vpc" },
        RouteTableIds: privateRouteTables,
      })),
    );
  });

  it("retains nothing after the stack is destroyed", () => {
    for (const [id, resource] of Object.entries(json.Resources)) {
      expect(resource.DeletionPolicy, id).toBeUndefined();
    }
  });

  it("exports every output under the stack's name", () => {
    expect(
      Object.entries(json.Outputs)
        .map(([name, output]) => [name, output.Export?.Name])
        .toSorted(),
    ).toEqual(
      [
        "Az1",
        "Az2",
        "Private1RouteTableId",
        "Private1SubnetId",
        "Private2RouteTableId",
        "Private2SubnetId",
        "Public1RouteTableId",
        "Public1SubnetId",
        "Public2RouteTableId",
        "Public2SubnetId",
        "VpcCidr",
        "VpcId",
      ].map((name) => [name, `AihNetwork-${name}`]),
    );
    expect(json.Outputs["Az2"]?.Value).toBe("ap-northeast-1c");
  });

  it("synthesizes without asking AWS anything", () => {
    expect(app.synth().manifest.missing).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("Fn::GetAZs");
  });
});

describe("NetworkStack, with the hourly parts switched on", () => {
  it("adds one NAT gateway in the first public subnet with `nat`", () => {
    const { template, ofType } = synth({ egress: "nat" });
    template.resourceCountIs("AWS::EC2::EIP", 1);
    expect(ofType("AWS::EC2::NatGateway").map(([id, nat]) => [id, nat.Properties?.["SubnetId"]])).toEqual([
      ["Public1NatGateway", { Ref: "Public1Subnet" }],
    ]);
    for (const name of ["Private1", "Private2"]) {
      template.hasResourceProperties("AWS::EC2::Route", {
        RouteTableId: { Ref: `${name}RouteTable` },
        DestinationCidrBlock: "0.0.0.0/0",
        NatGatewayId: { Ref: "Public1NatGateway" },
      });
    }
  });

  it("adds one NAT gateway per zone with `nat-per-az`", () => {
    const { template } = synth({ egress: "nat-per-az" });
    template.resourceCountIs("AWS::EC2::NatGateway", 2);
    template.resourceCountIs("AWS::EC2::EIP", 2);
    template.hasResourceProperties("AWS::EC2::Route", {
      RouteTableId: { Ref: "Private2RouteTable" },
      NatGatewayId: { Ref: "Public2NatGateway" },
    });
  });

  it("puts interface endpoints in the private subnets, open to HTTPS from the VPC only", () => {
    const { ofType } = synth({ interfaceEndpoints: "ecr.api,ecr.dkr,logs" });
    const interfaces = ofType("AWS::EC2::VPCEndpoint").filter(
      ([, endpoint]) => endpoint.Properties?.["VpcEndpointType"] === "Interface",
    );
    expect(interfaces.map(([id, endpoint]) => [id, endpoint.Properties])).toEqual(
      [
        ["EcrApi", "ecr.api"],
        ["EcrDkr", "ecr.dkr"],
        ["Logs", "logs"],
      ].map(([id, service]) => [
        `${id}InterfaceEndpoint`,
        {
          VpcEndpointType: "Interface",
          ServiceName: `com.amazonaws.ap-northeast-1.${service}`,
          VpcId: { Ref: "Vpc" },
          SubnetIds: privateSubnets,
          SecurityGroupIds: [{ "Fn::GetAtt": ["EndpointSecurityGroup", "GroupId"] }],
          PrivateDnsEnabled: true,
        },
      ]),
    );
    expect(ofType("AWS::EC2::SecurityGroup").map(([, group]) => group.Properties?.["SecurityGroupIngress"])).toEqual([
      [{ IpProtocol: "tcp", FromPort: 443, ToPort: 443, CidrIp: "10.20.0.0/16", Description: "HTTPS from the VPC" }],
    ]);
  });

  it("stays within the types and properties the pinned cdkd handles itself, except VPCEndpoint", () => {
    const { json, types } = synth({ egress: "nat-per-az", interfaceEndpoints: "ecr.api,ecr.dkr,logs" });
    // From src/provisioning/property-coverage.generated.ts at v0.296.28: the properties
    // cdkd's own EC2 provider writes. Anything else would be routed through Cloud Control.
    const handled: Record<string, string[]> = {
      "AWS::EC2::EIP": ["Domain", "Tags"],
      "AWS::EC2::InternetGateway": ["Tags"],
      "AWS::EC2::NatGateway": ["AllocationId", "SubnetId", "Tags"],
      "AWS::EC2::Route": ["DestinationCidrBlock", "GatewayId", "NatGatewayId", "RouteTableId"],
      "AWS::EC2::RouteTable": ["Tags", "VpcId"],
      "AWS::EC2::SecurityGroup": ["GroupDescription", "SecurityGroupIngress", "Tags", "VpcId"],
      "AWS::EC2::Subnet": ["AvailabilityZone", "CidrBlock", "MapPublicIpOnLaunch", "Tags", "VpcId"],
      "AWS::EC2::SubnetRouteTableAssociation": ["RouteTableId", "SubnetId"],
      "AWS::EC2::VPC": ["CidrBlock", "EnableDnsHostnames", "EnableDnsSupport", "Tags"],
      "AWS::EC2::VPCGatewayAttachment": ["InternetGatewayId", "VpcId"],
    };
    expect(types).toEqual([...Object.keys(handled), "AWS::EC2::VPCEndpoint"].toSorted());
    for (const [id, resource] of Object.entries(json.Resources)) {
      const allowed = handled[resource.Type];
      if (allowed !== undefined) {
        expect(allowed, id).toEqual(expect.arrayContaining(Object.keys(resource.Properties ?? {})));
      }
    }
  });
});
