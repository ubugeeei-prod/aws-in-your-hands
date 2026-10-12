import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import {
  CfnEIP,
  CfnInternetGateway,
  CfnNatGateway,
  CfnRoute,
  CfnRouteTable,
  CfnSecurityGroup,
  CfnSubnet,
  CfnSubnetRouteTableAssociation,
  CfnVPC,
  CfnVPCEndpoint,
  CfnVPCGatewayAttachment,
} from "aws-cdk-lib/aws-ec2";
import type { Construct } from "constructs";

import { exportName, outputNames } from "../../src/exports.ts";
import { type NetworkPlan, subnetsOf } from "../../src/plan.ts";

export type NetworkStackProps = StackProps & { plan: NetworkPlan };

const pascal = (service: string): string =>
  service
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

export class NetworkStack extends Stack {
  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { plan } = props;
    const named = (name: string) => [{ key: "Name", value: `${id}/${name}` }];

    // #region vpc
    const vpc = new CfnVPC(this, "Vpc", {
      cidrBlock: plan.vpcCidr,
      // Both are needed before an interface endpoint can answer under the service's usual DNS name.
      enableDnsSupport: true,
      enableDnsHostnames: true,
      tags: named("vpc"),
    });

    const internetGateway = new CfnInternetGateway(this, "InternetGateway", { tags: named("igw") });
    const attachment = new CfnVPCGatewayAttachment(this, "InternetGatewayAttachment", {
      vpcId: vpc.ref,
      internetGatewayId: internetGateway.ref,
    });
    // #endregion vpc

    // #region subnets
    const built = new Map<string, { subnet: CfnSubnet; routeTable: CfnRouteTable }>();
    for (const planned of plan.subnets) {
      const subnet = new CfnSubnet(this, `${planned.id}Subnet`, {
        vpcId: vpc.ref,
        cidrBlock: planned.cidr,
        availabilityZone: planned.availabilityZone,
        // A public IPv4 address is billed by the hour. Whoever needs one asks for it.
        mapPublicIpOnLaunch: false,
        tags: named(planned.id),
      });
      // One route table per subnet, so that no subnet falls back to the VPC's main route table.
      const routeTable = new CfnRouteTable(this, `${planned.id}RouteTable`, {
        vpcId: vpc.ref,
        tags: named(planned.id),
      });
      new CfnSubnetRouteTableAssociation(this, `${planned.id}RouteTableAssociation`, {
        subnetId: subnet.ref,
        routeTableId: routeTable.ref,
      });
      built.set(planned.id, { subnet, routeTable });
    }
    const at = (subnetId: string): { subnet: CfnSubnet; routeTable: CfnRouteTable } => {
      const found = built.get(subnetId);
      if (found === undefined) {
        throw new Error(`the plan refers to subnet "${subnetId}", which it does not define`);
      }
      return found;
    };
    // #endregion subnets

    // #region nat
    // Empty unless the plan asks for egress. Each one costs money from the moment it exists.
    const natGateways = new Map<string, CfnNatGateway>();
    for (const planned of plan.natGateways) {
      const address = new CfnEIP(this, `${planned.subnetId}NatAddress`, {
        domain: "vpc",
        tags: named("nat"),
      });
      const natGateway = new CfnNatGateway(this, `${planned.subnetId}NatGateway`, {
        subnetId: at(planned.subnetId).subnet.ref,
        allocationId: address.attrAllocationId,
        tags: named(`nat-${planned.availabilityZone}`),
      });
      natGateway.addDependency(attachment);
      natGateways.set(planned.availabilityZone, natGateway);
    }
    // #endregion nat

    // #region routes
    // The only difference between a public and a private subnet is this loop.
    for (const planned of plan.subnets) {
      const route = planned.defaultRoute;
      if (route === null) {
        continue;
      }
      const routeTableId = at(planned.id).routeTable.ref;
      if (route.via === "internet-gateway") {
        new CfnRoute(this, `${planned.id}DefaultRoute`, {
          routeTableId,
          destinationCidrBlock: "0.0.0.0/0",
          gatewayId: internetGateway.ref,
        }).addDependency(attachment);
        continue;
      }
      const natGateway = natGateways.get(route.availabilityZone);
      if (natGateway === undefined) {
        throw new Error(
          `${planned.id} routes to a NAT gateway in ${route.availabilityZone}, which the plan lacks`,
        );
      }
      new CfnRoute(this, `${planned.id}DefaultRoute`, {
        routeTableId,
        destinationCidrBlock: "0.0.0.0/0",
        natGatewayId: natGateway.ref,
      });
    }
    // #endregion routes

    // #region gateway-endpoints
    const privateSubnets = subnetsOf(plan, "private");
    for (const service of plan.gatewayEndpoints) {
      new CfnVPCEndpoint(this, `${pascal(service)}GatewayEndpoint`, {
        vpcEndpointType: "Gateway",
        serviceName: `com.amazonaws.${plan.region}.${service}`,
        vpcId: vpc.ref,
        // AWS adds a route to the service's prefix list in each of these tables.
        routeTableIds: privateSubnets.map((subnet) => at(subnet.id).routeTable.ref),
      });
    }
    // #endregion gateway-endpoints

    // #region interface-endpoints
    if (plan.interfaceEndpoints.length > 0) {
      const securityGroup = new CfnSecurityGroup(this, "EndpointSecurityGroup", {
        groupDescription: "HTTPS from inside the VPC to the interface endpoints",
        vpcId: vpc.ref,
        securityGroupIngress: [
          {
            ipProtocol: "tcp",
            fromPort: 443,
            toPort: 443,
            cidrIp: plan.vpcCidr,
            description: "HTTPS from the VPC",
          },
        ],
        tags: named("endpoints"),
      });
      for (const service of plan.interfaceEndpoints) {
        new CfnVPCEndpoint(this, `${pascal(service)}InterfaceEndpoint`, {
          vpcEndpointType: "Interface",
          serviceName: `com.amazonaws.${plan.region}.${service}`,
          vpcId: vpc.ref,
          subnetIds: privateSubnets.map((subnet) => at(subnet.id).subnet.ref),
          securityGroupIds: [securityGroup.attrGroupId],
          // The SDK keeps calling the usual hostname; inside the VPC it resolves to the endpoint.
          privateDnsEnabled: true,
        });
      }
    }
    // #endregion interface-endpoints

    // #region outputs
    const output = (name: string, value: string): void =>
      void new CfnOutput(this, name, { value, exportName: exportName(name) });

    output(outputNames.vpcId, vpc.ref);
    output(outputNames.vpcCidr, plan.vpcCidr);
    privateSubnets.forEach((subnet, index) =>
      output(outputNames.zone(index + 1), subnet.availabilityZone),
    );
    for (const planned of plan.subnets) {
      output(outputNames.subnetId(planned.id), at(planned.id).subnet.ref);
      output(outputNames.routeTableId(planned.id), at(planned.id).routeTable.ref);
    }
    // #endregion outputs
  }
}
