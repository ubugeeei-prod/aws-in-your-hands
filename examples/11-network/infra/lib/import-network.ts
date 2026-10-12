import { Fn } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import type { Construct } from "constructs";

import { exportName, outputNames } from "../../src/exports.ts";

// #region import
/**
 * The chapter 11 VPC, for a stack in another CDK app. Every value is an
 * Fn::ImportValue, so synthesis asks AWS nothing; the IDs arrive at deploy time.
 *
 * The private subnets come back as `isolatedSubnets`, which is what they are
 * unless the network was deployed with a NAT gateway.
 */
export function importNetwork(scope: Construct, id: string, zoneCount = 2): ec2.IVpc {
  const value = (name: string): string => Fn.importValue(exportName(name));
  const numbers = Array.from({ length: zoneCount }, (_, index) => index + 1);

  return ec2.Vpc.fromVpcAttributes(scope, id, {
    vpcId: value(outputNames.vpcId),
    vpcCidrBlock: value(outputNames.vpcCidr),
    availabilityZones: numbers.map((number) => value(outputNames.zone(number))),
    publicSubnetIds: numbers.map((number) => value(outputNames.subnetId(`Public${number}`))),
    publicSubnetRouteTableIds: numbers.map((number) =>
      value(outputNames.routeTableId(`Public${number}`)),
    ),
    isolatedSubnetIds: numbers.map((number) => value(outputNames.subnetId(`Private${number}`))),
    isolatedSubnetRouteTableIds: numbers.map((number) =>
      value(outputNames.routeTableId(`Private${number}`)),
    ),
  });
}
// #endregion import
