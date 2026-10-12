---
title: "11 Network: Deploy"
---

# 11 Network: Deploy

This page makes the VPC usable from the stacks of other chapters, then deploys it to real AWS.

## Using it from other stacks

<!-- section: 11.share -->

This VPC exists for the stacks of other chapters to use. The stack therefore turns the IDs of the VPC and its subnets into outputs and exports them under names.

<<< @/examples/11-network/infra/lib/network-stack.ts{outputs}

An export name has to be unique within an account and Region, so the stack name goes in front.

<<< @/examples/11-network/src/exports.ts{names}

The consumer is a different CDK app. Inside one app, CDK wires up references for you, but this book keeps one app per chapter, so the consumer fetches the values by name. A function does that.

<<< @/examples/11-network/infra/lib/import-network.ts{import}

Every value becomes an `Fn::ImportValue`, so synth asks AWS nothing and the real IDs arrive at deploy time. The tests check that every name this function asks for is a name the VPC stack exports. If you rename one side only, they fail.

### How cdkd handles exports

With CloudFormation, exports and `Fn::ImportValue` are features of CloudFormation itself. cdkd doesn't go through CloudFormation, so I checked in the documentation and source of the pinned version (0.296.28) whether the same thing works.

I found four things.

- cdkd stores outputs in its own state (`state.json` in S3), and records the export names with them
- cdkd resolves `Fn::ImportValue` from the state of other stacks. A name that no cdkd stack exports is looked up among CloudFormation's exports
- `cdkd destroy` refuses a stack whose exports are still in use (`StackHasActiveImportsError`). CloudFormation doesn't let you delete an exporting stack while it is imported either. cdkd protects the stack in the same way and has no flag to force it. Destroy the consumer first
- `Fn::GetStackOutput` also exists, a weak reference that doesn't block the destroy. cdkd's documentation calls it cdkd-specific, but the CloudFormation documentation lists a function with the same name. I haven't looked into how the two differ, and this book doesn't use it

Some things I don't know. I haven't run this path with cdkd. CloudFormation also refuses to change the value of an output that is imported. I haven't checked whether cdkd refuses in the same way (for instance, a change that replaces a subnet while a consuming stack remains). It is the first thing to run when chapter 12 gets written.

## Deploying

<!-- section: 11.deploy -->

Deploy the default layout first. It creates nothing billed by the hour.

```bash
vp run net:infra:diff
vp run net:infra:deploy
```

When it finishes it prints 12 outputs, such as `VpcId` and `Private1SubnetId`. Check the route tables with the next command, replacing `vpc-xxxxxxxx` with the `VpcId` that was printed.

```bash
aws ec2 describe-route-tables --region ap-northeast-1 --filters Name=vpc-id,Values=vpc-xxxxxxxx
```

The two public ones should have a `0.0.0.0/0` route. The two private ones shouldn't, and should have routes to the S3 and DynamoDB prefix lists instead.

To add hourly-billed parts, pass `-c`.

```bash
vp run net:infra:diff -c egress=nat
vp run net:infra:deploy -c egress=nat
```

After this deploy, the stack costs USD 0.067 an hour just by existing (the NAT gateway and its Elastic IP address).

Keep in mind that `-c` applies to that one command only. The next deploy without `-c` goes back to the default plan, and the NAT gateway shows up as a change that removes it. You can use that to turn the NAT gateway off. Always read `diff` first and see what goes away and what gets added before you deploy.

The drift check is the same as in chapter 02.

```bash
vp run net:infra:drift
```

I haven't been able to run the commands in this section against real AWS yet. Of the resource types involved, cdkd has its own implementation for VPCs, subnets, route tables, routes, internet gateways, NAT gateways, Elastic IP addresses, and security groups. `AWS::EC2::VPCEndpoint` is the one type without one, and it goes through Cloud Control API. Whether that works is the first thing I want to confirm.
