---
title: "11 The Network You Actually Need: VPC, Subnets, NAT, and Endpoints"
sourceRevision: 1
---

# 11 The Network You Actually Need: VPC, Subnets, NAT, and Endpoints

So far you haven't designed a single line of network. This is the chapter where you build your own.

What you'll build is a small VPC that spans two Availability Zones. The containers in chapter 12, the databases in chapter 13, and the EC2 instance in chapter 23 all sit on top of it.

One thing about money first. The default layout in this chapter contains **nothing that costs money just by existing**. It was built to be that way. There's also a switch that adds a NAT gateway or interface endpoints, though, and those are billed by the hour whether you use them or not. One NAT gateway comes to about USD 49 a month, and three interface endpoints to about USD 61 (Tokyo, 730 hours; the breakdown is in "What costs money just by existing"). If you try them, please remove them the same day.

The only prerequisite is [chapter 02](/en/chapters/02-toolchain.md). The code is in `examples/11-network/`.

## When do you need a VPC?

<!-- section: 11.when -->

Chapters 03 through 06 used CloudFront, S3, API Gateway, Lambda, DynamoDB, and Cognito. Every one of them is a service you talk to over HTTPS at a front door that AWS provides. You need no network on your side. Lambda, too, can reach the internet when you configure nothing.

A VPC (Virtual Private Cloud) is your own IP network inside a Region. You need one when you use **something that can only live inside a VPC**.

- RDS and Aurora databases (chapter 13)
- Node-based ElastiCache clusters (planned for chapter 14; ElastiCache Serverless also offers a public endpoint that needs no VPC configuration)
- ECS tasks (chapter 12)
- EC2 instances (chapter 23)

These have IP addresses and live in a subnet somewhere. They need a place to live.

Put the other way around: if Lambda, DynamoDB, S3, and API Gateway are enough for you, the right move is not to create a VPC. It makes nothing faster or safer. It only adds things to design and parts that cost money.

A VPC itself has no charge. Some of the parts you put inside it do. Most of the second half of this chapter is about that.

## The big picture

<!-- section: 11.architecture -->

```text
Region ap-northeast-1
└─ VPC AihNetwork  10.20.0.0/16
   ├─ internet gateway                                    (no charge)
   ├─ zone ap-northeast-1a
   │   ├─ Public1   10.20.0.0/20    route table: 0.0.0.0/0 -> internet gateway
   │   └─ Private1  10.20.128.0/20  route table: no route out of the VPC
   ├─ zone ap-northeast-1c
   │   ├─ Public2   10.20.16.0/20   route table: 0.0.0.0/0 -> internet gateway
   │   └─ Private2  10.20.144.0/20  route table: no route out of the VPC
   ├─ gateway endpoints: S3, DynamoDB                     (no charge)
   │     a route in the two private route tables
   └─ not created unless asked for                        (billed by the hour)
         NAT gateway + Elastic IP     -c egress=nat | nat-per-az
         interface endpoints          -c interfaceEndpoints=ecr.api,ecr.dkr,logs
```

Just three terms.

A **subnet** is a slice of the VPC's address range. One subnet lives in one Availability Zone (AZ). An AZ is a group of data centers inside a Region with its own power and its own networking.

A **public subnet** is a subnet with a route to the internet. A **private subnet** is one without. That's the whole difference, and as you'll see, a single route decides it.

By default, the private subnets in this chapter have no route out of the VPC at all. The AWS documentation calls that an isolated subnet, and keeps "private subnet" for one that can get out through NAT. Since a switch here adds NAT, this book calls both of them private.

Here are the VPC and its door to the internet.

<<< @/examples/11-network/infra/lib/network-stack.ts{vpc}

An internet gateway is the door you attach to a VPC, and it has no charge of its own. The two DNS settings are needed later, when you add interface endpoints, so they're on from the start.

### Why this is written with L1 constructs

CDK has a high-level construct called `Vpc` that builds something similar in a few lines. This chapter doesn't use it. It lines up `CfnVPC`, `CfnSubnet`, and the other constructs that map one to one onto CloudFormation resources (L1).

There are two reasons. One is that I didn't want to hide the point that one line in a route table decides what a subnet is. The other is a default of `Vpc`. The type definitions of the pinned version (aws-cdk-lib 2.273.0) say that `natGateways` defaults to "one per Availability Zone". Write `new Vpc(...)` without thinking, and for this chapter's layout you quietly get about USD 98 a month of NAT gateways.

Once you know how the pieces work, production code is shorter with `Vpc`, given `natGateways: 0` and the subnet types.

## Carving up the addresses

<!-- section: 11.cidr -->

The first thing you decide for a VPC is its address range, written like `10.20.0.0/16` (CIDR notation). `/16` means "the first 16 bits are shared", which leaves room for 65,536 addresses.

The settings come in through a Zod schema.

<<< @/examples/11-network/src/config.ts{schema}

Quite a few things here are beyond what types can guard. The type of `cidr` is `string`, but `"10.20.1.0/16"` (not the first address of its range) is a `string`, and so is `"8.8.0.0/16"` (not a private range). The schema rejects both. It also checks that the subnets are small enough for the number of zones.

Zones are given by name (`ap-northeast-1a`). One caveat: in the Tokyo Region, for accounts created before November 2025, the same name points to a different location in each account. This command shows the names your account can use (it needs credentials).

```bash
aws ec2 describe-availability-zones --region ap-northeast-1
```

If they differ from the two defaults, pass `-c availabilityZones=...`.

### CIDR arithmetic as plain functions

"Do these two ranges overlap?" and "how many /20 blocks fit in this range?" are arithmetic that has nothing to do with AWS. So they're pure functions, with tests.

<<< @/examples/11-network/src/cidr.ts{relations}

It's unglamorous, but there's one trap. Bitwise operators in JavaScript work on signed 32-bit integers, so building a large address such as `192.168.0.0` with `<<` gives you a negative number. This code multiplies and divides instead, and the tests round-trip addresses above `128.0.0.0`.

A subnet has five fewer usable addresses than it appears to. AWS keeps the first four and the last one of every subnet for itself.

<<< @/examples/11-network/src/cidr.ts{usable}

### The layout

<<< @/examples/11-network/src/plan.ts{plan}

The VPC is split in half: the lower half is public, the upper half private. Inside each half, every zone gets one /20. In `10.20.0.0/16` that uses only 4 of the 16 available /20 blocks.

They aren't packed together, so that there's room to add things later. A third zone, or a new tier (say, subnets just for databases), can be added without renumbering the subnets that exist. Changing a subnet's CIDR later means replacing the subnet, along with everything living in it. Leaving room at the start is the cheapest option.

`planNetwork` calls no AWS API. It only turns settings into a plan, and the stack turns that plan into resources as is. The tests vary the settings and check that no two subnets ever overlap and that all of them stay inside the VPC.

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

## Check it on your machine

<!-- section: 11.local -->

People tend to think you can't learn anything about a network without deploying it. But every decision you've seen so far can be checked on your machine. No AWS account needed.

```bash
vp run net:plan
```

It builds the plan from the settings and prints the subnets, the routes, the hourly-billed parts, and the monthly cost.

<<< @/examples/11-network/src/report.ts{report}

The same task shows what a different layout would do.

```bash
vp run net:plan egress=nat
vp run net:plan interfaceEndpoints=ecr.api,ecr.dkr,logs
vp run net:plan cidr=10.20.0.0/24 subnetPrefix=26
```

The monthly cost is on your screen before you add a NAT gateway. Much better than learning it from the bill, isn't it?

Tests and synth go like this.

```bash
vp run test:unit
vp run net:infra:synth
```

The stack tests check that the template of the default layout has no NAT gateway and no Elastic IP address. If someone changes a default and an hourly-billed resource slips in, this is where it fails. They also check that only public route tables have a route to the internet, that the gateway endpoints are attached to the private route tables only, that no resource is kept when the stack is destroyed, and that synth asks AWS nothing.

Here's what your machine does not reproduce.

- Whether packets actually arrive. The model looks at route tables only
- How security groups and network ACLs are evaluated
- DNS resolution for interface endpoints
- Whether those zone names are usable in your account
- That cdkd can create the resources as the template says

## Using it from other stacks

<!-- section: 11.share -->

This VPC exists for the stacks of other chapters to use. So its IDs are outputs, exported under names.

<<< @/examples/11-network/infra/lib/network-stack.ts{outputs}

An export name has to be unique within an account and Region, so the stack name goes in front.

<<< @/examples/11-network/src/exports.ts{names}

The consumer is a different CDK app. Inside one app, CDK wires up references for you, but this book keeps one app per chapter, so the values are fetched by name. There's a function for that.

<<< @/examples/11-network/infra/lib/import-network.ts{import}

Everything becomes an `Fn::ImportValue`, so synth asks AWS nothing. The real IDs arrive at deploy time. The tests check that every name this function asks for is a name the VPC stack exports. Rename one side only and they fail.

### How does cdkd handle exports?

With CloudFormation, exports and `Fn::ImportValue` are features of CloudFormation itself. cdkd doesn't go through CloudFormation, so I checked whether the same thing works, in the documentation and source of the pinned version (0.296.28).

What I found.

- cdkd stores outputs in its own state (`state.json` in S3), and records the export names with them
- cdkd resolves `Fn::ImportValue` from the state of other stacks. A name that no cdkd stack exports is looked up among CloudFormation's exports
- `cdkd destroy` refuses a stack whose exports are still in use (`StackHasActiveImportsError`). CloudFormation doesn't let you delete an exporting stack while it's imported either. Same protection, and no flag to force it. Destroy the consumer first
- There's also `Fn::GetStackOutput`, a weak reference that doesn't block the destroy. cdkd's documentation calls it cdkd-specific, but the CloudFormation documentation lists a function with the same name. I haven't looked into how the two differ, and this book doesn't use it

What I don't know. I haven't actually run this path with cdkd. CloudFormation also refuses to change the value of an output that is imported. Whether cdkd refuses in the same way (for instance, a change that replaces a subnet while a consuming stack remains) is something I haven't checked. It's the first thing to run when chapter 12 gets written.

## Deploying

<!-- section: 11.deploy -->

Start with the default layout. It creates nothing billed by the hour.

```bash
vp run net:infra:diff
vp run net:infra:deploy
```

When it finishes you get 12 outputs, such as `VpcId` and `Private1SubnetId`. Let's look at the route tables. Replace `vpc-xxxxxxxx` with the `VpcId` that was printed.

```bash
aws ec2 describe-route-tables --region ap-northeast-1 --filters Name=vpc-id,Values=vpc-xxxxxxxx
```

The two public ones should have a `0.0.0.0/0` route. The two private ones shouldn't, and should have routes to the S3 and DynamoDB prefix lists instead.

To add hourly-billed parts, pass `-c`.

```bash
vp run net:infra:diff -c egress=nat
vp run net:infra:deploy -c egress=nat
```

From here on it costs USD 0.067 an hour just to exist (the NAT gateway and its Elastic IP address).

Watch out for one thing: `-c` applies to that one command only. The next deploy without `-c` goes back to the default plan, and the NAT gateway shows up as a change that removes it. You can use that as the off switch. Always look at `diff` first and see what goes away and what gets added.

The drift check is the same as in chapter 02.

```bash
vp run net:infra:drift
```

To be honest, I haven't been able to run the commands in this section against real AWS yet. Of the resource types involved, cdkd has its own implementation for VPCs, subnets, route tables, routes, internet gateways, NAT gateways, Elastic IP addresses, and security groups. `AWS::EC2::VPCEndpoint` is the one type without one, and goes through Cloud Control API. Whether that works is the first thing I'd want to confirm.

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
