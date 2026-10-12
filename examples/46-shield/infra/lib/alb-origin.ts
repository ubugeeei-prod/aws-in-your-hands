import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import type { Construct } from "constructs";

// Three ways to put a load balancer behind CloudFront, for the tests and the page.
// No stack of this chapter deploys them: a load balancer is billed by the hour.
// HTTP to the origin only because, as in chapter 12, there is no certificate here.

// #region open
/** Chapter 12's shape: on the internet, and the security group admits everyone. */
export function openLoadBalancer(scope: Construct, vpc: ec2.IVpc) {
  const loadBalancer = new elbv2.ApplicationLoadBalancer(scope, "Open", {
    vpc,
    internetFacing: true,
    vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
  });
  loadBalancer.addListener("Http", {
    port: 80,
    open: true,
    defaultAction: elbv2.ListenerAction.fixedResponse(404),
  });
  return new origins.LoadBalancerV2Origin(loadBalancer, {
    protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
  });
}
// #endregion open

// #region prefix-list
/**
 * Still on the internet, but the security group admits only CloudFront's origin-facing
 * servers. The ID of `com.amazonaws.global.cloudfront.origin-facing` differs by Region
 * and is looked up by hand, so that synth asks AWS nothing.
 */
export function prefixListLoadBalancer(scope: Construct, vpc: ec2.IVpc, prefixListId: string) {
  const securityGroup = new ec2.SecurityGroup(scope, "FromCloudFront", {
    vpc,
    description: "HTTP from CloudFront only",
    allowAllOutbound: false,
  });
  securityGroup.addIngressRule(
    ec2.Peer.prefixList(prefixListId),
    ec2.Port.tcp(80),
    "CloudFront origin-facing servers",
  );
  const loadBalancer = new elbv2.ApplicationLoadBalancer(scope, "PrefixList", {
    vpc,
    internetFacing: true,
    vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    securityGroup,
  });
  loadBalancer.addListener("Http", {
    port: 80,
    // `open: true` is the default, and would add 0.0.0.0/0 next to the prefix list.
    open: false,
    defaultAction: elbv2.ListenerAction.fixedResponse(404),
  });
  return new origins.LoadBalancerV2Origin(loadBalancer, {
    protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
  });
}
// #endregion prefix-list

// #region vpc-origin
/** No public address at all: CloudFront comes in through a network interface of its own. */
export function privateLoadBalancer(scope: Construct, vpc: ec2.IVpc) {
  const loadBalancer = new elbv2.ApplicationLoadBalancer(scope, "Private", {
    vpc,
    internetFacing: false,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  });
  loadBalancer.addListener("Http", {
    port: 80,
    open: false,
    defaultAction: elbv2.ListenerAction.fixedResponse(404),
  });
  return origins.VpcOrigin.withApplicationLoadBalancer(loadBalancer, {
    protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
  });
}
// #endregion vpc-origin
