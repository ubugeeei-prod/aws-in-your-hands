---
title: "40 Disaster Recovery: Design and Build"
---

# 40 Disaster Recovery: Design and Build

[The previous page](/en/chapters/40-disaster-recovery.md) covered the pieces of DRS and what they cost. This page fills in, one at a time, what the chapter 23 instance lacks before it can be a source server, and turns the decisions of a drill into code.

## What a source server has to be

<!-- section: 40.source -->

The agent does not install on every server. The documentation lists supported operating systems and kernels, and three points matter for the chapter 23 instance.

- Amazon Linux 2023 is supported, up to kernel 6.12
- arm64 is supported only for Graviton EC2 instances recovering to AWS. An arm64 server on premises or in another cloud is not
- What is replicated is mounted disks. A volume that is attached but not formatted is not replicated

The chapter 23 instance is a `t4g.micro` (Graviton), and its data volume is mounted as XFS, so the second and third points hold. The first is the problem: the default AMI of chapter 23 has kernel 6.18.

A function checks the three points before any installation.

<<< @/examples/40-disaster-recovery/src/source.ts{source}

This function copies the documentation's list. What the installer really accepts is unknown to me, because I never ran it. The list changes with each release, so read it again on the day you try.

An arm64 server comes with one more rule. The recovery instance's type has to be a Graviton type too, and a mismatch fails a check before the launch.

## The paths the agent needs

<!-- section: 40.network -->

The chapter 23 instance sits in a private subnet with no NAT. From there it reached only Systems Manager and S3, through the endpoints of chapter 11. DRS adds three paths.

```figure
caption: The agent and the replication server both open their own connections. In the default layout they reach DRS and EC2 through this chapter's endpoints, and S3 through the gateway endpoint of chapter 11
node src: EC2 instance (chapter 23) | Private1, zone 1
node rs: Replication server | Private2, zone 2
node vpce: Interface endpoints (this chapter) | drs, ec2, zone 2 only
node gw: S3 gateway endpoint (chapter 11)
node drs: Elastic Disaster Recovery
node ec2: EC2 API
node s3: S3 | installer, AL2023 packages
edge src -> rs: tcp 1500
edge src -> vpce: HTTPS 443
edge rs -> vpce: HTTPS 443
edge src -> gw
edge rs -> gw
edge vpce -> drs
edge vpce -> ec2
edge gw -> s3
group vpc: VPC AihNetwork = src, rs, vpce, gw
mark rs
```

The first is HTTPS from the agent to DRS. The agent stays connected to `drs.ap-northeast-1.amazonaws.com` on port 443, to report the state of replication and to receive commands.

The second is port 1500 from the agent to the replication server. Disk blocks travel this way. An interface endpoint for DRS carries management traffic only; replication data does not go through it.

The third is on the staging side. The replication server has to reach DRS, the EC2 API, and S3. From S3 it takes the replication software and Amazon Linux 2023 packages, because the replication server itself runs Amazon Linux 2023.

The required paths are listed so that the route model of chapter 11 can check them.

<<< @/examples/40-disaster-recovery/src/network.ts{needs}

The staging area goes in a different zone from the source, so that losing the source's zone does not take the replica with it.

<<< @/examples/40-disaster-recovery/src/network.ts{layout}

The list of interface endpoints the chapter 11 stack can add has neither `drs` nor `ec2`. Chapter 11's files are not mine to change, so this chapter's stack creates the two itself.

<<< @/examples/40-disaster-recovery/infra/lib/dr-stack.ts{staging}

The endpoints live in one zone only. An interface endpoint is billed per zone, and a second zone would add USD 20.44 a month. The zone chosen is the one that survives, the staging area's. The agent in zone 1 uses the endpoints across zones.

Two things about these paths were not checked. One is whether the agent uses an endpoint that resolves through private DNS as it is. For an on-premises source reaching the endpoint over a VPN, the documentation says to pass the endpoint's DNS name to the installer with `--endpoint`. From inside the VPC the usual host name should resolve to the endpoint, but I did not try it. The other is that no dedicated subnet was created for the staging area. The documentation recommends one. This chapter uses the chapter 11 subnet as it is.

With `-c placement=public` no endpoints are created. The source and the replication server reach DRS through the internet gateway. In exchange, the replication server needs a public IPv4 address.

### The chapter 23 security group has no port 1500

The security group of the chapter 23 instance narrowed outbound traffic to port 443. As it is, the agent would reach DRS and then stop at port 1500, where the blocks go.

The security group is a resource of the chapter 23 stack. This chapter's stack only takes its ID and adds one outbound rule.

<<< @/examples/40-disaster-recovery/infra/lib/dr-stack.ts{agent}

The second half of the code is that part. The destination is limited to the VPC and the port to 1500. On the receiving side the replication server uses the security group DRS provides. That group opens inbound 1500, and DRS restores its rules if they are changed, according to the documentation.

Adding a rule to another stack's resource from outside has a price. Chapter 23's source has no rule for port 1500, so a drift check on the chapter 23 side may show it as a difference (whether it does was not checked). The setting belongs in the chapter 23 stack, which owns the instance.

## The agent's permissions

<!-- section: 40.agent -->

Installing the agent takes AWS credentials. The documentation offers two ways.

For a server on premises, you create a role with `AWSElasticDisasterRecoveryAgentInstallationPolicy` and hand the installer temporary credentials obtained with STS `AssumeRole`. The documentation recommends temporary credentials over long-lived access keys.

For an EC2 instance, no credentials have to be created. If the role of the instance profile has `AWSElasticDisasterRecoveryEc2InstancePolicy`, the agent takes credentials from IMDS, as chapter 23 described. This chapter uses that way, because no key has to be stored anywhere.

The AWS managed `AWSElasticDisasterRecoveryEc2InstancePolicy` includes permissions this chapter does not use: `sts:AssumeRole` on a role in another account, and creating source networks. So this chapter writes a policy with the same contents minus those two, and with resources narrowed to source servers of this Region and account. The first half of the code above is that policy.

Only the four actions for installation and registration keep `*` as their resource. The AWS policy has `*` there as well: before registration no source server exists that could be named. The tests pin that the list of actions is these fifteen, that `*` appears in this one statement only, and that tagging is allowed only while a source server is being created.

That the agent works with the narrowed policy was not checked. If it does not, first swap in the AWS managed policy to tell a permission gap from anything else.

The role is a resource of the chapter 23 stack too, so this stack takes its name and attaches the policy, nothing more. You find the role's name and the security group's ID from the instance ID, after deploying chapter 23.

```bash
aws ec2 describe-instances --region ap-northeast-1 --instance-ids i-xxxxxxxxxxxxxxxxx --query 'Reservations[].Instances[].[SecurityGroups[].GroupId,IamInstanceProfile.Arn]'
aws iam get-instance-profile --instance-profile-name <the name at the end of that ARN> --query 'InstanceProfile.Roles[].RoleName'
```

As chapter 23 said, a permission given to the instance's role is a permission given to every piece of code on that machine. The notes API process can now call the agent's DRS APIs with the same credentials.

## What can be declared, and what cannot

<!-- section: 40.declarable -->

So far in this book, resources were written into a stack. With DRS the range where that works is narrow.

Four things exist as CloudFormation resource types: the replication configuration template, the launch configuration template, the source network, and the recovery plan. Initializing the service, installing the agent, a source server, starting a drill or a recovery, terminating recovery instances, and failback are all API calls and not resources. A source server comes into being when the agent registers itself, and cannot be written in a template.

And those four are not available in every Region. CloudFormation publishes, per Region, a zip of the definitions of the resource types usable there. In the ones downloaded on 2026-10-13, the `AWS::DRS` definitions were present for us-east-1 and us-west-2, and ap-northeast-1 had none. Neither did ap-northeast-3, us-east-2, eu-west-1, or ap-southeast-1. The table of contents of the CloudFormation Template Reference had no `AWS::DRS` entry either.

The same holds for cdkd. The pinned cdkd (0.296.28) has no dedicated provider for `AWS::DRS`, so it goes through Cloud Control API, and Cloud Control API handles only the types registered in the Region.

So by default the two templates are not in the stack. A pure function builds their contents.

<<< @/examples/40-disaster-recovery/src/templates.ts{replication}

The point-in-time policy has a fixed shape. There are exactly three rules; the minute and hour rules cannot be changed, and the only thing you choose is how many days the daily snapshots are kept.

<<< @/examples/40-disaster-recovery/src/templates.ts{pit}

The same function has two exits. One is the CLI commands that call the API. `vp run dr:plan` only prints them and runs nothing. The request body is passed as JSON, so the value the function returned is the value the API receives.

<<< @/examples/40-disaster-recovery/src/templates.ts{commands}

The other exit is the stack. Only with `-c templates=declare` do the same values become `AWS::DRS` resources.

<<< @/examples/40-disaster-recovery/infra/lib/dr-stack.ts{templates}

This one is kept for a Region that has the definitions. In Tokyo it should fail to deploy, for the reason just given. Even where the definitions exist, I did not check whether a template can be created before initialization, or whether it collides with the default template the console creates when it initializes. According to the quota list, there can be one launch configuration template per account and Region.

The EC2 launch template is a different matter. DRS creates it when a source server registers and deletes it when the server is disconnected. The documentation says not to change its name or its device names. A resource DRS owns is not something to pull into your own stack. You set the subnet, security group, instance type, and instance profile in the console or through the EC2 API.

## Deciding a drill

<!-- section: 40.planner -->

The API that starts a drill is `StartRecovery`. It takes source server IDs, the point in time to launch from, and whether this is a drill. Leave the point out, and DRS tries to take a snapshot on the spot.

What has to be decided before that is a function: which servers can launch, from which point, how much data that loses, and whether the loss is within the RPO you set.

<<< @/examples/40-disaster-recovery/src/drill.ts{plan}

**This function is a model of the behaviour the documentation describes. It is not DRS.** It knows nothing about conversion time, instance capacity, or quotas. "Can launch" here does not mean DRS will succeed in launching.

Three rules come from the documentation.

A server whose initial sync has not finished cannot launch. Once it has, a drill is possible even when the server lags or replication has stalled.

When you name a time, the snapshot taken at that time or slightly before is used. The function picks the newest one at or before the time. It never picks a later one because it is closer: returning to a state after the incident would defeat the purpose.

When you choose the most recent data, DRS connects to the source server to take a snapshot. If the source is down, you wait for that to time out. In a real disaster the wait is part of the RTO, and an existing snapshot can be the faster choice.

A loss that is unknown is a different value from a loss that is within the objective, so that a server reporting no lag is not treated as having none. Lag comes back as `lagDuration`, and all the API reference says about it is "a string of 1 to 64 characters". There is no format.

<<< @/examples/40-disaster-recovery/src/drs.ts{lag}

If the value reads as an ISO 8601 duration (`PT4S` and the like) it becomes seconds, and otherwise it is unknown. I have not seen what the service really returns.

API responses are checked with Valibot before any decision uses them. Only these parts are used.

<<< @/examples/40-disaster-recovery/src/drs.ts{shapes}

The list of state names comes from the API reference and the SDK's type definitions. A state that is not on the list stops at validation. An unknown state is never waved through with a default.

The request is built from the plan.

<<< @/examples/40-disaster-recovery/src/drill.ts{request}

A drill and a real recovery differ by the boolean `isDrill` alone. The path you walked in a drill is therefore the path of a recovery.

The part that calls AWS sits behind an interface.

<<< @/examples/40-disaster-recovery/src/adapter.ts{port}

The tests implement this interface with responses written by hand. They were written from the member names and value patterns of the API reference, and were not recorded from an account. The top of `examples/40-disaster-recovery/test/fixtures.ts` says so. The real implementation follows, and it has never run.

<<< @/examples/40-disaster-recovery/src/adapter.ts{aws}

### A launch alone is not a pass

That an instance launched and that the app works are two different facts. The checks after the launch decide whether a drill passed.

<<< @/examples/40-disaster-recovery/src/drill.ts{checks}

If even one check was not done, the result is "incomplete", not "passed". A drill where someone was satisfied by the launch and never looked at the notes must not be recorded as a pass.

`volume-mounted` is what the unit of chapter 23 guarded with `AssertPathIsMountPoint`. When the instance comes up without the data volume mounted, the API returns no notes and looks, at a glance, as if it works.

## The order of a recovery

<!-- section: 40.order -->

A recovery has an order. The server that holds the data comes first, the app that uses it next, and redirecting clients last. That order is written as data.

<<< @/examples/40-disaster-recovery/src/order.ts{graph}

In the notes app there is one instance, with the data and the app on the same machine, so there are four steps. Before the address is switched there is a step that makes sure the original server takes no more writes. [The distributed view](/en/chapters/40-disaster-recovery/wrap.md) explains why.

With many servers, the order of launches can be left to a DRS recovery plan. The checks and the switch after the launch are yours either way.

The function that runs the order stops at a failure and resumes where it stopped when called again.

<<< @/examples/40-disaster-recovery/src/order.ts{run}

The tests reproduce a failing app check in a fixed order. The first run stops at the check and never reaches the address switch. The second run starts again from the check and does not launch a second instance.

Another test covers a switch that succeeded while its answer was lost. To the function that is a failure, so the next run performs the switch again. Every step has to be an operation that is harmless to perform twice. Writing a DNS record to the same value is. Running an instance launch twice makes two instances.

## Receiving DRS events

<!-- section: 40.events -->

DRS emits launch results, replication stalling and resuming, and failback states as EventBridge events.

<<< @/examples/40-disaster-recovery/infra/lib/dr-stack.ts{events}

There is also an event for every snapshot taken, but it fires every 10 minutes per source server, so the rule leaves it out.

The only description of the events I read is the samples in the user guide. Whether the EventBridge schema registry has definitions was not looked up. The schemas copy the samples.

<<< @/examples/40-disaster-recovery/src/events.ts{schemas}

`is-drill`, which says whether the launch was a drill, is not a boolean in the samples but the strings `"TRUE"` and `"FALSE"`. An unknown state or a value of another type fails validation. A failed event is logged whole, as an error, so that a change in the event's shape shows up in the logs.

<<< @/examples/40-disaster-recovery/src/events.ts{classify}

The event for stalled replication is logged as an error, because while replication is stalled the point you can return to keeps getting older. A failed drill is a warning and a failed real recovery an error. A drill exists to find failures.

The function writes one log line and nothing else.

<<< @/examples/40-disaster-recovery/src/events-lambda.ts{handler}

Chapter 19 shows how to make an alarm from logs. This chapter's stack has no alarm and no notification. In production, something that tells a person replication has stopped is a must.
