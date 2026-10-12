---
title: "11 Network: Design and Build"
---

# 11 Network: Design and Build

## One line in a route table separates public from private

<!-- section: 11.routes -->

Each subnet is associated with one route table: a list of rules saying "traffic for this destination goes there".

<<< @/examples/11-network/infra/lib/network-stack.ts{subnets}

Up to this point, public and private subnets are built exactly the same way. The difference shows up only in the next loop.

<<< @/examples/11-network/infra/lib/network-stack.ts{routes}

One line that sends `0.0.0.0/0` (every destination) to the internet gateway. A subnet whose route table has it is public; a subnet whose route table doesn't is private. There's no "private" setting anywhere.

Every route table starts out with a route for traffic inside the VPC (the local route). So a resource in a private subnet can talk to a resource in a public subnet of the same VPC. What it can't reach is anything outside the VPC.

There's also a reason every subnet gets its own route table. A VPC comes with a main route table, and any subnet not associated with a route table follows that one. If somebody adds a route to the internet there, every subnet whose association was forgotten turns public. To avoid that, all four are associated explicitly.

One more thing: `mapPublicIpOnLaunch` is `false` on the public subnets. Sitting in a public subnet isn't enough for a resource to talk to the internet. It also needs a public IPv4 address. And each of those costs USD 0.005 an hour, USD 3.65 a month. They aren't handed out automatically here; a resource that needs one asks for it.

The tests check that, in the default layout, only the two public route tables have a route to the internet.

## Security groups remember the reply

<!-- section: 11.firewall -->

Having a route and being allowed to talk are two different things. A route table decides where traffic can be delivered. Whether what arrives is accepted is up to the security group.

A security group is a set of rules attached to resources such as instances, and all it can express is "allow". It's also stateful: replies to traffic you allowed get through without a rule in the other direction.

In this chapter a security group appears only when you add interface endpoints.

<<< @/examples/11-network/infra/lib/network-stack.ts{interface-endpoints}

It allows one thing, inbound: "port 443, from inside the VPC". There's no rule to let the endpoint's replies out. Being stateful, it doesn't need one.

There's a similarly named thing, the network ACL. It sits at the edge of a subnet, can express both allow and deny, and is evaluated in numeric order. And it's stateless: allowing the way out doesn't allow the way back.

A VPC comes with a network ACL that allows everything. This chapter leaves it alone. The AWS documentation, too, says you can protect your resources with security groups alone. You need network ACLs when you want to write a deny, as in "refuse traffic from this range for the whole subnet".

To be honest, I haven't confirmed the behavior in this section (replies getting through, the difference from network ACLs) by sending traffic in real AWS. It's what the documentation says.

## Three ways to call AWS from a private subnet

<!-- section: 11.egress -->

A container in a private subnet wants to read a file from S3. It wants to pull its image from ECR. It wants to send logs to CloudWatch Logs. All of those are AWS services, but their front doors are outside the VPC. Without a route, nothing gets there.

There are three ways.

**Gateway endpoints.** These work for S3 and DynamoDB only. A route saying "traffic for this service goes here" is added to the route table. There's no additional charge, so they're created by default.

<<< @/examples/11-network/infra/lib/network-stack.ts{gateway-endpoints}

**Interface endpoints.** These put a door to a service inside your subnets, with a private IP address (AWS PrivateLink). Many services support them, but each costs USD 0.014 an hour per service, per zone, plus USD 0.01 per GB that passes through. You saw the code above; thanks to `privateDnsEnabled`, the SDK calls the usual hostname and lands on the endpoint.

**NAT gateways.** A NAT gateway is a relay that lets private subnets reach the whole internet. It sits in a public subnet and holds one Elastic IP address. It reaches not only AWS services but also external APIs and the npm registry. Each one costs USD 0.062 an hour, plus USD 0.062 per GB that passes through.

<<< @/examples/11-network/infra/lib/network-stack.ts{nat}

Which one you choose follows from what you want to call.

| | Reaches | Charge for existing | Traffic |
| --- | --- | --- | --- |
| Gateway endpoint | S3 and DynamoDB in the same Region | None | None |
| Interface endpoint | Only the services you added | USD 0.014 an hour per endpoint, per zone | USD 0.01 per GB |
| NAT gateway | The whole internet | USD 0.062 an hour each, plus USD 0.005 an hour for its public IPv4 address | USD 0.062 per GB |

To run chapter 12's Fargate tasks in private subnets, pulling the image from ECR takes the two interface endpoints `ecr.api` and `ecr.dkr` plus the S3 gateway endpoint, and sending logs takes the `logs` interface endpoint. For Session Manager in chapter 23 it's `ssm`, `ssmmessages`, and `ec2messages`. The interface endpoints this chapter's stack can add are limited to seven: the ones those two chapters use, plus `secretsmanager`.

<<< @/examples/11-network/src/config.ts{options}

"What can a private subnet reach?" is a function too. It only reads the plan's route tables and asks AWS nothing.

<<< @/examples/11-network/src/reach.ts{reach}

It's a simple model that doesn't look at security groups or DNS. Even so, it lets a test pin down that "in the default layout, a private subnet can't reach ECR, and can reach S3". This is a spot where a lot of people actually get stuck.

## What costs money just by existing

<!-- section: 11.cost -->

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax, with a 730-hour month. The arithmetic is in [Pricing calculations](/en/reference/pricing.md).

| Layout | Billed by the hour | Monthly cost with no traffic | With 10 GB a month |
| --- | --- | --- | --- |
| Default | Nothing | 0 | 0 |
| `-c egress=nat` | 1 NAT gateway, 1 public IPv4 address | 48.91 | 49.53 |
| `-c egress=nat-per-az` | 2 NAT gateways, 2 public IPv4 addresses | 97.82 | 98.44 |
| `-c interfaceEndpoints=ecr.api,ecr.dkr,logs` | 3 interface endpoints × 2 zones | 61.32 | 61.42 |

The 0 for the default isn't a 0 written because the price is unknown. VPCs, subnets, route tables, internet gateways, and gateway endpoints simply have no charge.

The table tells you three things.

**A NAT gateway is USD 45.26 a month with no traffic at all.** Its Elastic IP address adds USD 3.65. Public IPv4 addresses are billed at the same rate whether they're in use or not.

**Interface endpoints multiply by count and by zone.** One endpoint in two zones is USD 20.44 a month. With three of them, you pay more than for one NAT gateway before any traffic. Endpoints come out ahead when a lot of data passes through. Comparing these two layouts, they cross over at roughly 240 GB a month (the per-GB difference is USD 0.052, the fixed difference USD 12.41).

**Less than an hour still counts as an hour.** Create a NAT gateway or an interface endpoint and delete it five minutes later, and you're billed for one hour.

Some things aren't in this table: data transfer out to the internet, and data transfer across zones (that doesn't mean 0; they're not included). The 10 GB of traffic is only an assumption. The documentation describes a Free Tier allowance for public IPv4 addresses, but I couldn't confirm whether a NAT gateway's Elastic IP address qualifies, so nothing is deducted.

How the hourly parts are counted is in code.

<<< @/examples/11-network/src/cost.ts{billable}

The tests check that the hours this function produces match the scenarios in the pricing data, and that the amounts in the table above match the calculated results. Change a layout and forget to fix the numbers in the text, and a test fails.

## Should Lambda go in a VPC?

<!-- section: 11.lambda -->

Only when it has to talk to something inside the VPC. An RDS database, for example. There's no reason to put a function that only calls DynamoDB or S3 into a VPC.

When you do, you give some things up.

**The route to the internet.** A Lambda function with nothing configured can reach the internet, but a function attached to a VPC can reach only what that VPC can reach. Attaching it to a public subnet doesn't help. The Lambda documentation is explicit: connecting a function to a public subnet gives it neither internet access nor a public IP address.

So to call Secrets Manager or SQS from a function in a VPC, you need one of the three ways above. DynamoDB and S3 are reachable through the gateway endpoints, so this chapter's default layout is enough for those. For anything else, it's an interface endpoint or a NAT gateway. This is the first point where "costs money just by existing" enters a Lambda setup.

**Tightly scoped permissions.** Attaching to a VPC requires six EC2 permissions on the execution role, for creating and deleting network interfaces. The documentation asks you to allow them on all resources (`"Resource": "*"`). And your function's code gets those permissions too. Since chapter 04 the rule has been "no `*`"; this is an exception.

**Being ready right away.** The first time a function is attached to a VPC, Lambda prepares a network interface. Meanwhile the function is in the Pending state and can't be invoked. According to the documentation, this can take several minutes. A function that isn't invoked for 14 days has its network interface reclaimed and becomes Inactive, and the next invocation fails.

This chapter has no sample of a Lambda function in a VPC. There's nothing inside the VPC to talk to yet. Chapter 13 covers it, together with a database.

## Two zones, still one Region

<!-- section: 11.zones -->

The subnets are spread over two zones so that when one zone stops, the other can keep going. Zones have separate power and networking and are built not to fail together. RDS, too, requires subnets in two different zones.

But before saying "two zones, so we're safe", there are two things to check.

First: is anything shared across the zones? `-c egress=nat` puts a single NAT gateway in the first zone. It's cheaper, and this is what happens.

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

Look at step 2. Zone 1a is the one that stopped, yet 1c, which should be fine, can no longer reach the internet. Its way out depended on 1a. A single NAT gateway has undone the point of having two zones.

The test replays exactly this sequence.

<<< @/examples/11-network/test/reach.test.ts{zone-failure}

With `nat-per-az`, 1c keeps its way out. In exchange, the fixed cost doubles. One for development, one per zone when an outage would hurt: you decide, and neither is the correct answer. What matters is knowing what goes down together in the layout you chose.

Second: step 4. A zone is a division **inside a Region**. A VPC exists in one Region only. If the whole Region is impaired, nothing in this VPC is reachable, however many zones it has. Multiple zones protect you against the failure of one zone, not against the failure of a Region. Preparing for that means another full set in another Region, which is a different design and outside this chapter.

The invariant of this section, in one sentence: "a private subnet in a zone that is up still reaches whatever it reached before another zone went down". `nat-per-az` and the default layout satisfy it; `nat` doesn't. The tests pin that down.

One caveat: what this test breaks is a model of the plan. Nobody stopped a real zone.
