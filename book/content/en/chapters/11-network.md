---
title: "11 Network: VPC, Subnets, NAT, and Endpoints"
sourceRevision: 3
---

# 11 Network: VPC, Subnets, NAT, and Endpoints

None of the chapters so far asked you to design a network. In this one you build your own for the first time.

You build a small VPC that spans two Availability Zones. The containers in chapter 12, the databases in chapter 13, and the EC2 instance in chapter 23 all go on top of it.

A word on cost before anything else. The default layout in this chapter contains **nothing that costs money just by existing**, and it was built to be that way. One setting adds a NAT gateway or interface endpoints, though, and those parts are billed by the hour whether you use them or not. One NAT gateway comes to about USD 49 a month, and three interface endpoints to about USD 61 (Tokyo, 730 hours; the breakdown is under "What costs money just by existing" in [Design and Build](/en/chapters/11-network/build.md)). If you try them, remove them the same day.

The only prerequisite is [chapter 02](/en/chapters/02-toolchain.md). The code is in `examples/11-network/`.

## When you need a VPC

<!-- section: 11.when -->

Chapters 03 through 06 used CloudFront, S3, API Gateway, Lambda, DynamoDB, and Cognito. You talk to every one of them over HTTPS at an entrance that AWS provides, so you need no network of your own, and a Lambda function with nothing configured can reach the internet.

A VPC (Virtual Private Cloud) is your own IP network inside a Region. You need one when you use something that can only be placed inside a VPC, such as these.

- RDS and Aurora databases (chapter 13)
- Node-based ElastiCache clusters ([chapter 14](/en/chapters/14-kv-cache.md); ElastiCache Serverless also offers a public endpoint that needs no VPC configuration)
- ECS tasks (chapter 12)
- EC2 instances (chapter 23)

Each of these has an IP address and sits in a subnet, so it needs a VPC to sit in.

If Lambda, DynamoDB, S3, and API Gateway cover what you need, the better layout is one without a VPC. A VPC makes nothing faster or safer, and it adds things to design and parts that cost money.

A VPC itself has no charge. Some of the parts you put inside it do, and [Design and Build](/en/chapters/11-network/build.md) keeps coming back to which ones and how much.

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

You need three terms to read the figure.

A subnet is a slice of the VPC's address range. Each subnet sits in one Availability Zone (AZ), and an AZ is a group of data centers inside a Region with its own power and its own networking.

A public subnet has a route to the internet, and a private subnet has none. The only difference between the two is one route in a route table, which [Design and Build](/en/chapters/11-network/build.md) shows.

By default, the private subnets in this chapter have no route out of the VPC at all. The AWS documentation calls a subnet with no route out an isolated subnet, and keeps "private subnet" for one that can get out through NAT. Because a setting here adds NAT, this book calls both of them private.

This is the code for the VPC and its way in and out of the internet.

<<< @/examples/11-network/infra/lib/network-stack.ts{vpc}

An internet gateway is the entrance and exit you attach to a VPC, and it has no charge of its own. The two DNS settings are needed later, when you add interface endpoints, so they are on from the start.

### Why L1 constructs

CDK has a high-level construct called `Vpc` that builds something similar in a few lines. This chapter doesn't use it. It lines up `CfnVPC`, `CfnSubnet`, and the other constructs that map one to one onto CloudFormation resources (L1).

There are two reasons. The first is that `Vpc` would hide the fact that one line in a route table decides what kind of subnet you have. The second is a default of `Vpc`. The type definitions of the pinned version (aws-cdk-lib 2.273.0) say that `natGateways` defaults to "one per Availability Zone". If you write `new ec2.Vpc(...)` without checking the defaults, this chapter's layout gets about USD 98 a month of NAT gateways that you never asked for.

Once you know how the parts work, production code is shorter with `Vpc`, given `natGateways: 0` and the subnet types.

## Allocating the addresses

<!-- section: 11.cidr -->

The first thing you decide for a VPC is its address range, written like `10.20.0.0/16` (CIDR notation). `/16` means "the first 16 bits are shared", so the range holds 65,536 addresses.

The settings come in through a Valibot schema.

<<< @/examples/11-network/src/config.ts{schema}

The schema holds several conditions that types alone can't guard. The type of `cidr` is `string`, but so is `"10.20.1.0/16"`, which isn't the first address of its range, and so is `"8.8.0.0/16"`, which isn't a private range. The schema rejects both. It also checks that the subnets are small enough for the number of zones. The conditions that compare several fields sit together in `v.rawCheck`, which runs after each field has passed its own checks and reports a problem under the name of the field it belongs to.

You give zones by name (`ap-northeast-1a`). In the Tokyo Region, though, for accounts created before November 2025, the same name points to a different location in each account. This command shows the names your account can use (it needs credentials).

```bash
aws ec2 describe-availability-zones --region ap-northeast-1
```

If they differ from the two defaults, pass `-c availabilityZones=...`.

### CIDR arithmetic as pure functions

"Do these two ranges overlap?" and "how many /20 blocks fit in this range?" are arithmetic that has nothing to do with AWS, so they are pure functions with tests.

<<< @/examples/11-network/src/cidr.ts{relations}

This arithmetic has one trap. Bitwise operators in JavaScript work on signed 32-bit integers, so building a large address such as `192.168.0.0` with `<<` gives a negative number. This code multiplies and divides instead, and the tests check that addresses above `128.0.0.0` survive the trip to a number and back.

A subnet has five fewer usable addresses than its size suggests, because AWS reserves the first four and the last one of every subnet.

<<< @/examples/11-network/src/cidr.ts{usable}

### The layout

<<< @/examples/11-network/src/plan.ts{plan}

The VPC's range is split in two. The half with the lower addresses is public and the half with the higher addresses is private, and inside each half every zone gets one /20. In `10.20.0.0/16` that uses only 4 of the 16 available /20 blocks.

The subnets aren't packed together, so that you can add to them later. A third zone, or a new tier such as subnets just for databases, fits in without renumbering the subnets that exist. Changing a subnet's CIDR later means replacing the subnet along with everything in it, so leaving room at the start is the cheapest option.

`planNetwork` calls no AWS API. It only turns settings into a plan, and the stack turns that plan into resources as it stands. The tests vary the settings and check that no two subnets ever overlap and that all of them stay inside the VPC.
