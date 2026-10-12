---
title: "11 Network: VPC, Subnets, NAT, and Endpoints"
sourceRevision: 1
---

# 11 Network: VPC, Subnets, NAT, and Endpoints

So far you haven't designed a single line of network. This is the chapter where you build your own.

What you'll build is a small VPC that spans two Availability Zones. The containers in chapter 12, the databases in chapter 13, and the EC2 instance in chapter 23 all sit on top of it.

One thing about money first. The default layout in this chapter contains **nothing that costs money just by existing**. It was built to be that way. There's also a switch that adds a NAT gateway or interface endpoints, though, and those are billed by the hour whether you use them or not. One NAT gateway comes to about USD 49 a month, and three interface endpoints to about USD 61 (Tokyo, 730 hours; the breakdown is in "What costs money just by existing"). If you try them, please remove them the same day.

The only prerequisite is [chapter 02](/en/chapters/02-toolchain.md). The code is in `examples/11-network/`.

## When do you need a VPC?

<!-- section: 11.when -->

Chapters 03 through 06 used CloudFront, S3, API Gateway, Lambda, DynamoDB, and Cognito. Every one of them is a service you talk to over HTTPS at a front door that AWS provides. You need no network on your side. Lambda, too, can reach the internet when you configure nothing.

A VPC (Virtual Private Cloud) is your own IP network inside a Region. You need one when you use **something that can only live inside a VPC**.

- RDS and Aurora databases (chapter 13)
- Node-based ElastiCache clusters ([chapter 14](/en/chapters/14-kv-cache.md); ElastiCache Serverless also offers a public endpoint that needs no VPC configuration)
- ECS tasks (chapter 12)
- EC2 instances (chapter 23)

These have IP addresses and live in a subnet somewhere. They need a place to live.

Put the other way around: if Lambda, DynamoDB, S3, and API Gateway are enough for you, the right move is not to create a VPC. It makes nothing faster or safer. It only adds things to design and parts that cost money.

A VPC itself has no charge. Some of the parts you put inside it do. Most of the second half of this chapter is about that.

## The big picture

<!-- section: 11.architecture -->

```figure
caption: The VPC AihNetwork in ap-northeast-1 has one public and one private subnet in each of two zones, ap-northeast-1a and ap-northeast-1c
direction: right
node pub1: Public1 | zone 1a, 10.20.0.0/20
node pub2: Public2 | zone 1c, 10.20.16.0/20
node priv1: Private1 | zone 1a, 10.20.128.0/20, no route out
node priv2: Private2 | zone 1c, 10.20.144.0/20, no route out
node nat: NAT gateway + Elastic IP | -c egress=nat or nat-per-az
node iface: interface endpoints | -c interfaceEndpoints=ecr.api,ecr.dkr,logs
node igw: internet gateway | no charge
node gwep: gateway endpoints | S3, DynamoDB, no charge
edge pub1 -> igw: 0.0.0.0/0
edge pub2 -> igw: 0.0.0.0/0
edge priv1 -> gwep: a route in the route table
edge priv2 -> gwep
group vpc: VPC AihNetwork 10.20.0.0/16 = pub1, pub2, priv1, priv2, nat, iface, igw, gwep
group opt: not created unless asked for (billed by the hour) = nat, iface
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

There are two reasons. One is that I didn't want to hide the point that one line in a route table decides what a subnet is. The other is a default of `Vpc`. The type definitions of the pinned version (aws-cdk-lib 2.273.0) say that `natGateways` defaults to "one per Availability Zone". Write `new ec2.Vpc(...)` without thinking, and for this chapter's layout you quietly get about USD 98 a month of NAT gateways.

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
