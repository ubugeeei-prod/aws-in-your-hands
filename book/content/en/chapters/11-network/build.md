---
title: "11 Network: Design and Build"
---

# 11 Network: Design and Build

This page turns the VPC planned on [the previous page](/en/chapters/11-network.md) into the code of a stack. It covers routes, which traffic is allowed, the ways out of the VPC, cost, and what happens when a zone fails.

## The one route that separates public from private

<!-- section: 11.routes -->

Each subnet is associated with one route table, which is a list of rules that say "traffic for this destination goes there".

<<< @/examples/11-network/infra/lib/network-stack.ts{subnets}

Up to this point, public and private subnets are built in exactly the same way. They differ only in the next loop.

<<< @/examples/11-network/infra/lib/network-stack.ts{routes}

What kind of subnet you have depends on one route, the one that sends `0.0.0.0/0` (every destination) to the internet gateway. A subnet whose route table has that route is public, and a subnet whose route table lacks it is private. No setting anywhere says "private".

Every route table starts out with a route for traffic inside the VPC (the local route). A resource in a private subnet can therefore talk to a resource in a public subnet of the same VPC. Only what lies outside the VPC is out of its reach.

Every subnet gets its own route table so that none depends on the main route table. A VPC comes with a main route table, and any subnet that isn't associated with a route table follows it. If somebody adds a route to the internet there, every subnet whose association was forgotten turns public, so all four are associated explicitly.

`mapPublicIpOnLaunch` is also `false` on the public subnets. A resource can't talk to the internet just because it sits in a public subnet. It needs a public IPv4 address as well, and each one costs USD 0.005 an hour, USD 3.65 a month. The subnets therefore hand none out automatically, and a resource that needs one asks for it.

The tests check that, in the default layout, only the two public route tables have a route to the internet.

## Security groups and network ACLs

<!-- section: 11.firewall -->

Having a route is not the same as being allowed to talk. A route table decides where traffic can be delivered, and a security group decides whether the traffic that arrives is accepted.

A security group is a set of rules attached to resources such as instances, and the only thing a rule can say is "allow". It is also stateful, so a reply to traffic you allowed gets through without a rule in the other direction.

In this chapter a security group appears only when you add interface endpoints.

<<< @/examples/11-network/infra/lib/network-stack.ts{interface-endpoints}

It allows one thing, inbound: port 443 from inside the VPC. No rule lets the endpoint's replies out, and because the group is stateful, none is needed.

The network ACL has a similar name. It sits at the edge of a subnet, can both allow and deny, and evaluates its rules in numeric order. It is stateless, so traffic you allowed on the way out still needs its own rule on the way back.

A VPC comes with a network ACL that allows everything, and this chapter leaves it alone. The AWS documentation also says you can protect your resources with security groups alone. You need a network ACL when you want to write a deny, such as refusing traffic from one range for a whole subnet.

The behavior described in this section (replies getting through, the difference from network ACLs) is what the documentation says. I haven't confirmed it by sending traffic in real AWS.

## Three ways to call AWS from a private subnet

<!-- section: 11.egress -->

Suppose a container in a private subnet reads a file from S3, pulls its image from ECR, and sends logs to CloudWatch Logs. All three are AWS services, but their entrances are outside the VPC, so without a route nothing gets there.

There are three ways to get there.

The first is a gateway endpoint, which works for S3 and DynamoDB only. Creating one adds a route to the route table that says "traffic for this service goes here". It has no additional charge, so the stack creates both by default.

<<< @/examples/11-network/infra/lib/network-stack.ts{gateway-endpoints}

The second is an interface endpoint, which puts an entrance to a service inside your subnets, with a private IP address (AWS PrivateLink). Many services support it, but it costs USD 0.014 an hour per service, per zone, plus USD 0.01 per GB that passes through. The code is the block you saw in the section on security groups. Because `privateDnsEnabled` is on, the SDK calls the usual hostname and reaches the endpoint.

The third is a NAT gateway, a relay that lets private subnets reach the whole internet. It sits in a public subnet and holds one Elastic IP address. It reaches external APIs and the npm registry as well as AWS services. Each one costs USD 0.062 an hour, plus USD 0.062 per GB that passes through.

<<< @/examples/11-network/infra/lib/network-stack.ts{nat}

Which one you choose depends on what you want to call.

| | Reaches | Charge for existing | Traffic |
| --- | --- | --- | --- |
| Gateway endpoint | S3 and DynamoDB in the same Region | None | None |
| Interface endpoint | Only the services you added | USD 0.014 an hour per endpoint, per zone | USD 0.01 per GB |
| NAT gateway | The whole internet | USD 0.062 an hour each, plus USD 0.005 an hour for its public IPv4 address | USD 0.062 per GB |

To run chapter 12's Fargate tasks in private subnets, pulling the image from ECR takes the two interface endpoints `ecr.api` and `ecr.dkr` plus the S3 gateway endpoint, and sending logs takes the `logs` interface endpoint. Session Manager in chapter 23 takes `ssm`, `ssmmessages`, and `ec2messages`. The interface endpoints this chapter's stack can add are limited to seven: the ones those two chapters use, plus `secretsmanager`.

<<< @/examples/11-network/src/config.ts{options}

Working out what a private subnet can reach is a function too. It only reads the plan's route tables and asks AWS nothing.

<<< @/examples/11-network/src/reach.ts{reach}

The model is simple and ignores security groups and DNS, but it lets a test pin down that in the default layout a private subnet can't reach ECR and can reach S3. Many people get stuck at exactly this point when they build a real network.

## What costs money just by existing

<!-- section: 11.cost -->

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax, with a 730-hour month. The arithmetic is in [Pricing calculations](/en/reference/pricing.md).

| Layout | Billed by the hour | Monthly cost with no traffic | With 10 GB a month |
| --- | --- | --- | --- |
| Default | Nothing | 0 | 0 |
| `-c egress=nat` | 1 NAT gateway, 1 public IPv4 address | 48.91 | 49.53 |
| `-c egress=nat-per-az` | 2 NAT gateways, 2 public IPv4 addresses | 97.82 | 98.44 |
| `-c interfaceEndpoints=ecr.api,ecr.dkr,logs` | 3 interface endpoints × 2 zones | 61.32 | 61.42 |

The 0 for the default layout doesn't stand in for an unknown price. VPCs, subnets, route tables, internet gateways, and gateway endpoints have no charge in the first place.

The table shows three things.

A NAT gateway costs USD 45.26 a month with no traffic at all, and its Elastic IP address adds USD 3.65. Public IPv4 addresses are billed at the same rate whether they are in use or not.

The cost of interface endpoints is their number multiplied by the number of zones. One endpoint in two zones is USD 20.44 a month, and three of them cost more than one NAT gateway before any traffic. Endpoints come out ahead when a lot of data passes through. Between the `-c egress=nat` layout and the layout with three interface endpoints, the lines cross at roughly 240 GB a month (the per-GB difference is USD 0.052, the fixed difference USD 12.41).

Less than an hour of use is still billed as an hour. If you create a NAT gateway or an interface endpoint and delete it five minutes later, you pay for one hour.

Some things aren't in this table: data transfer out to the internet, and data transfer across zones (they are left out, which doesn't mean they are 0). The 10 GB of traffic is only an assumption. The documentation describes a Free Tier allowance for public IPv4 addresses, but I couldn't confirm whether a NAT gateway's Elastic IP address qualifies, so nothing is deducted.

The way the hourly parts are counted is in code.

<<< @/examples/11-network/src/cost.ts{billable}

The tests check that the hours this function produces match the scenarios in the pricing data, and that the amounts in the table above match the calculated results. If you change a layout and forget to fix the numbers in the text, a test fails.

## Putting Lambda in a VPC

<!-- section: 11.lambda -->

Put a Lambda function in a VPC only when it has to talk to something inside the VPC, such as an RDS database. A function that only calls DynamoDB or S3 has no reason to be there.

A function in a VPC gives up three things.

The first is its route to the internet. A Lambda function with nothing configured can reach the internet, but a function attached to a VPC can reach only what that VPC can reach. The Lambda documentation states that connecting a function to a public subnet gives it neither internet access nor a public IP address.

To call Secrets Manager or SQS from a function in a VPC, you therefore need one of the three ways described under "Three ways to call AWS from a private subnet". DynamoDB and S3 are reachable through the gateway endpoints, so this chapter's default layout is enough for those. Any other service takes an interface endpoint or a NAT gateway. This is the first point at which a Lambda setup includes something that costs money just by existing.

The second is tightly scoped permissions. Attaching a function to a VPC requires six EC2 permissions on its execution role, for creating and deleting network interfaces. The documentation asks you to allow them on all resources (`"Resource": "*"`), and the function's code holds those permissions too. The book has avoided `*` since chapter 04, and this is an exception.

The third is being ready to invoke right away. The first time a function is attached to a VPC, Lambda prepares a network interface. Until that finishes, the function is in the Pending state and can't be invoked. According to the documentation, this can take several minutes. A function that isn't invoked for 14 days also has its network interface reclaimed and becomes Inactive, and the next invocation fails.

This chapter has no sample of a Lambda function in a VPC, because the VPC has nothing in it to talk to yet. Chapter 13 covers it, together with a database.

## Two zones, still one Region

<!-- section: 11.zones -->

The subnets are spread over two zones so that when one zone stops, the other can keep going. Zones have separate power and networking and are built so that they rarely fail together. RDS also requires subnets in two different zones.

Two zones alone don't make the layout safe, though, and there are two things to check.

The first is whether anything is shared across the zones. `-c egress=nat` puts a single NAT gateway in the first zone. It costs less, and when a zone stops it behaves like this.

```text
layout: -c egress=nat  (one NAT gateway, in ap-northeast-1a)

step  event                  Private1 (1a) -> internet   Private2 (1c) -> internet
1     both zones up          via NAT gateway in 1a       via NAT gateway in 1a
2     zone 1a goes down      down with its zone          no way out: its NAT gateway was in 1a
3     same, traffic to S3    down with its zone          still works: gateway endpoint, no NAT involved

layout: -c egress=nat-per-az  (one NAT gateway per zone)

2'    zone 1a goes down      down with its zone          via NAT gateway in 1c

any layout

4     the whole region is impaired: nothing in this VPC is reachable; a second zone does not help
```

In step 2, zone 1a is the one that stopped, yet 1c, which should be unaffected, can no longer reach the internet either, because its way out was the NAT gateway in 1a. Using a single NAT gateway has undone the point of having two zones.

The test below replays steps 1 to 3 in order for the `nat` layout, and then checks that zone 1a doesn't notice when 1c is the one that fails. Steps 2' and 4 are separate tests in the same file.

<<< @/examples/11-network/test/reach.test.ts{zone-failure}

With `nat-per-az`, 1c keeps its way out, and the fixed cost doubles. You can choose one NAT gateway for development and one per zone where an outage would hurt, and neither choice is the correct one. What matters is knowing what stops together in the layout you chose.

The second is step 4. A zone is a division inside a Region, and a VPC exists in one Region only. If the whole Region is impaired, nothing in this VPC is reachable, however many zones it has. Multiple zones cover the failure of one zone and do not cover the failure of a Region. Covering that takes another full set in another Region, which is a different design and outside this chapter.

The invariant of this section, in one sentence, is "a private subnet in a zone that is up still reaches whatever it reached before another zone went down". `nat-per-az` and the default layout satisfy it, and `nat` doesn't. What the tests pin down is that `nat` doesn't, and that with `nat-per-az` the surviving side still reaches the internet whichever zone goes down. No test takes one zone down in the default layout. What is pinned for the default layout is that a private subnet has no route out and reaches only S3 and DynamoDB.

What this test breaks is a model of the plan. It does not stop a real zone.
