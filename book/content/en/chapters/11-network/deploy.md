---
title: "11 Network: Deploy"
---

# 11 Network: Deploy

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
