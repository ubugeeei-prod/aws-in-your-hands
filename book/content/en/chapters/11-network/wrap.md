---
title: "11 Network: Costs, Pitfalls, and Cleanup"
---

# 11 Network: Costs, Pitfalls, and Cleanup

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| The deploy fails while creating a subnet | Are the zone names usable in your account? Check with `aws ec2 describe-availability-zones` and pass `-c availabilityZones=...` |
| A container in a private subnet can't pull its image, or an AWS API call never returns | There's no route. Under "From Private1" in `vp run net:plan`, is that destination `unreachable`? |
| You added an interface endpoint and still can't reach the service | Does the endpoint's security group allow port 443 from the caller? Are both DNS settings on the VPC enabled? |
| S3 works, but a bucket in another Region doesn't | A gateway endpoint covers the service in the same Region only |
| `net:infra:destroy` stops with `StackHasActiveImportsError` | A stack that uses this VPC still exists. Destroy that one first |
| You're billed although nothing is in use | NAT gateways, interface endpoints, and public IPv4 addresses are billed without traffic. Are the settings you passed to `vp run net:plan` the ones you actually deployed? |
| A Lambda function in the VPC can't call an external API | That's "Should Lambda go in a VPC?". Attaching it to a public subnet doesn't get it out |
| It stops with `Invalid network settings` | The message says which field is wrong and why. Write a CIDR with the first address of its range (`10.20.0.0/16`, not `10.20.1.0/16`) |

The symptoms in the first four rows are pieced together from the documentation. I haven't made them happen.

## If you take this to production

- **Choose a CIDR that doesn't overlap your other networks.** If you later connect this to an office network or another VPC, you can't write routes between overlapping ranges. The AWS documentation also says to avoid `172.17.0.0/16`
- **Have a way out in every zone, or decide not to.** If you keep a single NAT gateway, write down what stops when its zone stops
- **Put policies on the gateway and interface endpoints.** Right now anything that goes through an endpoint can reach any bucket. You can narrow that to the buckets and actions you use
- **Use three zones.** The Tokyo Region has at least three. The planning function keeps the existing numbers when you add a third
- **Don't use the default security group.** A VPC comes with one, and a resource created without a security group lands in it. Create your own per purpose (chapter 12)
- **Deploy through the AWS CDK CLI and CloudFormation.** cdkd's own documentation describes cdkd as a tool for development and testing and recommends the AWS CDK CLI for production (chapter 02)
- **Set up spending notifications.** The budget from chapter 01 is the last net for noticing a NAT gateway you forgot to delete. It's a notification, not a cap

## Cleaning up

<!-- section: 11.cleanup -->

```bash
vp run net:infra:destroy
```

The VPC, subnets, route tables, internet gateway, and endpoints are deleted. So are the NAT gateways and Elastic IP addresses, if you added any. Nothing is meant to remain outside the stack, and a test checks that no resource carries a setting to keep it (`DeletionPolicy`).

Destroy the stacks that use this VPC (chapter 12 onward) first. While they exist, the destroy is refused.

If all you want is not to leave hourly-billed parts running overnight, you don't have to delete the whole VPC: deploying once more without `-c` removes them. Either way, the sure thing is to look for yourself at the end.

```bash
aws ec2 describe-nat-gateways --region ap-northeast-1 --filter Name=state,Values=available
aws ec2 describe-vpc-endpoints --region ap-northeast-1
```

If the first is empty and the second lists no endpoint of type Interface, this chapter's hourly charges have stopped.

What remains is only the storage that cdkd's bootstrap created (chapter 02).

::: details Verification notes for this chapter

**Checked locally.** The unit tests for CIDR arithmetic, settings validation, the route model, the pricing inputs, the stack assertions, and the match between imports and exports. Type checking. `net:infra:synth` (the default layout, and `-c egress=nat-per-az -c interfaceEndpoints=ecr.api,ecr.dkr,logs`). `net:plan` (the defaults, `egress=nat`, `egress=nat-per-az`, `interfaceEndpoints=ecr.api,ecr.dkr,logs`, and invalid settings). The amounts in the text are what `tools/src/pricing/calc.ts` calculates from the Price List unit prices, and `examples/11-network/test/pricing.test.ts` compares them. The AWS CLI flags (`--filters`, and `--filter` for `describe-nat-gateways`) were checked in the help of AWS CLI 2.35.11 from the devShell.

**Not checked yet.** `net:infra:diff`, `net:infra:deploy`, `net:infra:drift`, and `net:infra:destroy` have not been run against real AWS. So all of the following still wait for a real environment: that cdkd 0.296.28 can create and delete this stack. That `AWS::EC2::VPCEndpoint` can be created through Cloud Control API. That traffic from a private subnet actually arrives through the gateway and interface endpoints. How security groups and network ACLs behave. That deploying again without `-c` removes the NAT gateway. That a stack in another app can read the values with `Fn::ImportValue`, and that the destroy is refused while they're in use. Whether the default zone names (`ap-northeast-1a`, `ap-northeast-1c`) are usable in every account. The symptoms in "Where people get stuck". The behavior of a Lambda function in a VPC was only read in the documentation, and there is no sample.

What primary sources couldn't settle. Whether the Free Tier allowance for public IPv4 addresses (750 hours) applies to a NAT gateway's Elastic IP address. The Price List also has a separate SKU called Regional NAT Gateway (USD 0.062 an hour, USD 0.062 per GB), which this chapter doesn't cover and whose specification I haven't read. I also didn't look into whether Cloudflare has an experience that corresponds to a VPC, so there's no comparison.

The resource types cdkd handles. In `src/provisioning/register-providers.ts` at the `v0.296.28` tag, `AWS::EC2::VPC`, `Subnet`, `InternetGateway`, `VPCGatewayAttachment`, `RouteTable`, `Route`, `SubnetRouteTableAssociation`, `SecurityGroup`, `EIP`, and `NatGateway` are registered with a dedicated implementation (the EC2 provider). `AWS::EC2::VPCEndpoint` isn't registered and isn't on the unsupported list either, so it goes through Cloud Control API. When a template uses a property the dedicated implementation doesn't write, that resource is routed to Cloud Control API, so this stack uses only properties the dedicated implementation handles, and a test pins the list. The npm tarball doesn't contain the TypeScript sources, so I read the archive of the GitHub tag.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture | `examples/11-network/infra/lib/network-stack.ts`, `infra/bin/app.ts` | `net:infra:synth` |
| Carving up the addresses | `examples/11-network/src/cidr.ts`, `src/config.ts`, `src/plan.ts`, `test/cidr.test.ts`, `test/plan.test.ts` | `test:unit`, `net:plan` |
| One line in a route table separates public from private | `examples/11-network/infra/lib/network-stack.ts`, `infra/test/network-stack.test.ts` | `test:unit`, `net:infra:synth` |
| Security groups remember the reply | `examples/11-network/infra/lib/network-stack.ts` | none |
| Three ways to call AWS from a private subnet | `examples/11-network/infra/lib/network-stack.ts`, `src/reach.ts`, `test/reach.test.ts` | `test:unit`, `net:plan` |
| What costs money just by existing | `examples/11-network/src/cost.ts`, `test/pricing.test.ts`, `scripts/plan.ts`, `data/pricing/` | `test:unit`, `net:plan` |
| Two zones, still one Region | `examples/11-network/src/reach.ts`, `test/reach.test.ts` | `test:unit` |
| Check it on your machine | `examples/11-network/scripts/plan.ts`, `src/report.ts`, `infra/test/network-stack.test.ts` | `net:plan`, `test:unit`, `net:infra:synth` |
| Using it from other stacks | `examples/11-network/src/exports.ts`, `infra/lib/import-network.ts`, `infra/test/import-network.test.ts` | `test:unit` |
| Deploying | `examples/11-network/infra/bin/app.ts`, `cdk.json`, `tools/src/infra/` | `net:infra:diff`, `net:infra:deploy`, `net:infra:drift` |
| Cleaning up | `tools/src/infra/` | `net:infra:destroy` |

**Primary sources** (all checked on 2026-10-11)

- [What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html), [Subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html), [Subnet CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html), [VPC CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html)
- [Route table concepts](https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html), [Internet gateways](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html), [NAT gateway basics](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html)
- [Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html), [Default security groups](https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html), [Network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html), [Infrastructure security in Amazon VPC](https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html)
- [Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html), [Interface VPC endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html), [AWS services that integrate with AWS PrivateLink](https://docs.aws.amazon.com/vpc/latest/privatelink/aws-services-privatelink-support.html), [AWS::EC2::VPCEndpoint](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-vpcendpoint.html), [AWS::EC2::Subnet](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-subnet.html), [Get exported outputs from a deployed CloudFormation stack](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-exports.html)
- [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/), [AWS PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/)
- AWS Price List bulk API: [EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.json) (NAT gateways; about 445 MB), [VPC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-northeast-1/index.json) (interface endpoints, public IPv4 addresses)
- [Giving Lambda functions access to resources in an Amazon VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [Amazon ECR interface VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html), [Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html), [VPC endpoints for Systems Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html), [Working with a DB instance in a VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html), [Amazon VPCs and ElastiCache security](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/VPCs.html)
- [AWS Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html), [AZ IDs](https://docs.aws.amazon.com/global-infrastructure/latest/regions/az-ids.html), AWS Fault Isolation Boundaries: [Availability Zones](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/availability-zones.html), [Regions](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/regions.html)
- cdkd v0.296.28: [src/provisioning](https://github.com/go-to-k/cdkd/tree/v0.296.28/src/provisioning), [Cross-Stack References](https://github.com/go-to-k/cdkd/blob/v0.296.28/docs/cross-stack-references.md), [Introduction](https://cdkd.dev/introduction/)

:::
