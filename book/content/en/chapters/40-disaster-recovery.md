---
title: "40 Disaster Recovery: Elastic Disaster Recovery (DRS), Drills, and Failback"
sourceRevision: 1
---

# 40 Disaster Recovery: Elastic Disaster Recovery (DRS), Drills, and Failback

[Chapter 22](/en/chapters/22-recovery.md) brought back data that had been deleted. [Chapter 23](/en/chapters/23-ec2.md) kept one server and accepted that everything stops when it stops. This chapter is about being ready for the day that server becomes unusable together with the place it runs in.

The service is AWS Elastic Disaster Recovery. Its API and CLI name is `drs`, so the rest of the chapter calls it DRS. DRS keeps copying a server's disk writes to another place and, when you need it, launches a server from the copy.

What this chapter sets up **is billed by the hour for as long as it exists**. Protecting the one instance from chapter 23 adds about USD 2.07 a day, or USD 62.82 for a month of 730 hours, on top of chapters 23 and 11, in the default layout and without a single drill. Some further items have an amount I could not determine; they are listed under "What it costs just to exist" on this page. The charges stop when you disconnect and delete the source server and destroy this chapter's stack. Stopping the instance does not stop them. The steps are in [the cleanup](/en/chapters/40-disaster-recovery/wrap.md).

One more thing up front. The DRS documentation supports Amazon Linux 2023 up to kernel 6.12. The default AMI of chapter 23 has, as that chapter says, shipped kernel 6.18 since August 2026, so as it stands it is not supported. If you try this, pin the chapter 23 instance to an AMI with an older kernel using `-c amiId=`.

Nothing in this chapter was run against AWS: no deployment, no agent installation, no drill. What was checked locally is the decision code and the contents of the stack. The code is in `examples/40-disaster-recovery/`.

## What DRS does, and what it does not

<!-- section: 40.what -->

DRS replicates the disks of servers. You install a program called the AWS Replication Agent on the server you want to protect, and the agent captures disk writes block by block and keeps sending them to a staging area in the recovery Region. The server may be a physical machine in a data center, a virtual machine in another cloud, or an EC2 instance in another Region or another Availability Zone. This chapter replicates the chapter 23 instance to another zone of the same Region.

The staging area holds the replicated disks and a small instance that receives them, and nothing else. No instance the size of the original is waiting there. Only at recovery time do you launch a recovery instance from the snapshot of the point in time you choose. The design trades recovery time for the cost of keeping a standby.

There are three things DRS does not do.

First, it does not replicate managed services. The agent goes on a server with an operating system, so a DynamoDB table or an S3 bucket cannot be a source. Those have their own mechanisms (chapter 22 and [chapter 28](/en/chapters/28-multi-region.md)).

Second, it is not a backup you keep for a long time. The points in time DRS holds are every 10 minutes for the last hour, every hour for the last 24 hours, and daily before that; the daily ones are kept 7 days by default, and the setting goes from 1 to 365 days. The AWS Backup snapshots of chapter 22 can be kept, according to its documentation, from 1 day to 100 years, or indefinitely if you give no period. DRS cannot answer a request to go back six months. A point that has left the retention is gone.

Third, it does not redirect traffic. DRS stops at launching the instance. The failover, pointing clients at it, is something you perform outside DRS, as the documentation says in so many words.

The state DRS replicates is crash consistent: what the disk would hold had the power been cut at that instant. Data that was in memory and not yet written is not in it. The notes API of chapter 23 answers 201 only after the write has reached the disk, which suits this property well.

## What it costs just to exist

<!-- section: 40.cost -->

Amounts are in USD, at on-demand list prices for the Tokyo Region, before tax. A month is 730 hours. Every figure is added to what chapters 23 and 11 cost, for one source server and no drill.

| Layout | A day | A month |
| --- | --- | --- |
| Default (private subnets) | 2.07 | 62.82 |
| `-c placement=public` | 1.51 | 46.03 |

The parts are these.

- The DRS fee: USD 0.028 an hour per replicating source server, 20.44 for 730 hours. It does not change with the number or size of disks, or with the number of drills
- The replication server: the EC2 instance that receives data in the staging area. The default `t3.small` is USD 0.0272 an hour, 19.86 for 730 hours
- Staging disks: EBS volumes the size of the source disks. Disks of 125 GiB or less are magnetic by default, at USD 0.08 per GB-month. The 8 GiB root volume of chapter 23 (that chapter's assumption) and its 8 GiB data volume come to 1.28
- Snapshots: the pricing page says each source disk needs one base snapshot of the disk's size. Taken as 16 GB at USD 0.05 per GB-month, that is 0.80
- Interface endpoints (default layout only): this chapter's stack adds two, `drs` and `ec2`, in one zone. Each is USD 0.014 an hour, 20.44 together for 730 hours
- A public IPv4 address (`placement=public` only): the replication server holds one. USD 0.005 an hour, 3.65 for 730 hours

Some items are not in the table. Their amount is unknown, not zero: the incremental snapshots of each point in time (they depend on how much is written), the replication server's own root volume, I/O requests on magnetic volumes (USD 0.08 per million), endpoint data processing, data transfer between zones, and surplus CPU credits of the `t3`. No free tier is deducted, because I could not confirm that one applies.

A drill adds EC2 and EBS charges while its instance exists. A `t4g.micro` kept for two hours is about USD 0.03. The same instance forgotten for a month is 9.42. The conversion server that runs for a few minutes at each launch is not included; the pricing page puts it at generally under USD 0.05 per launch.

What is billed, and when, is written as code.

<<< @/examples/40-disaster-recovery/src/cost.ts{billable}

You can print the amounts locally, without an AWS account.

```bash
vp run dr:plan kernel=6.1
vp run dr:plan kernel=6.1 placement=public
```

Without `kernel=`, the task assumes the kernel of chapter 23's default AMI (6.18) and ends by reporting that the source is not supported.

Replicating across Regions adds charges that are not here. The documentation says the initial sync, ongoing replication, and failback each incur inter-Region data transfer. This chapter stays within one Region, so none of that is calculated.

## The whole picture

<!-- section: 40.pieces -->

```figure
caption: The agent keeps sending writes to the replication server, and a recovery instance is launched from a snapshot only when it is needed
node src: EC2 instance (chapter 23) | zone 1, AWS Replication Agent
node drs: Elastic Disaster Recovery | ap-northeast-1
node rs: Replication server | t3.small, zone 2
node disk: Staging disks | EBS
node pit: Point-in-time snapshots | every 10 min, hour, day
node ri: Recovery instance | drill or recovery only
edge src -> drs: HTTPS 443
edge src -> rs: tcp 1500 (blocks)
edge rs -> drs: HTTPS 443
edge rs -> disk
edge disk -> pit
edge pit --> ri: StartRecovery
group staging: Staging area = rs, disk, pit
mark ri
```

Here are the pieces, in the order they come into being.

**Initialization.** DRS has to be initialized once in each Region you use it in. That creates a service-linked role and roles for the replication servers, the conversion servers, recovery instances, the agent, and failback.

**Replication settings.** The subnet that becomes the staging area, the type of the replication server, disk encryption, and how many days snapshots are kept. One template holds the defaults, and they are copied to each source server as it is added.

**The agent.** The program you install on the source server. Installing it registers the server and starts the initial sync.

**A source server.** One protected server, as DRS sees it. It is also the unit of billing.

**Launch settings and the EC2 launch template.** Which subnet and which instance type a recovery instance gets is decided by an EC2 launch template created for each source server.

**Drill and recovery.** The same operation, differing in one value that says whether this is a drill. A drill affects neither the original server nor the replication.

**Failback.** Replicating what changed on the recovery side back to the original place. Between EC2 instances, you start reversed replication from the recovery instance.

Beyond these there are post-launch actions, which run SSM documents after a launch; recovery plans, which launch several servers in order; and source networks, which replicate a VPC's configuration and restore it as a CloudFormation stack. This chapter has one server and one VPC, and uses none of them.

What this chapter's stack creates is the surroundings of DRS.

<<< @/examples/40-disaster-recovery/src/config.ts{schema}

Most of DRS's own settings cannot be created by a stack. [What can be declared, and what cannot](/en/chapters/40-disaster-recovery/build.md) explains why.

## When DRS is the wrong tool

<!-- section: 40.when-not -->

Most readers of this book do not need DRS.

The app built in chapters 03 to 22 has no server to replicate. Lambda, API Gateway, and DynamoDB offer no place to install an agent. Disaster recovery for that app is deploying the same stacks in another Region, and moving the data. The first is the pipeline of chapter 20; the second is the mechanisms of chapter 22 and [chapter 28](/en/chapters/28-multi-region.md).

The chapter 23 instance does not necessarily need DRS either. That instance was made to be rebuilt from code: user data prepares the machine, releases are in S3, and the notes come back from a snapshot of the data volume. If a zone becomes unusable, you create the stack in another zone and restore the volume from the snapshot. What you lose is the notes written after the last snapshot, and what it takes is the time to rebuild. If you can accept those two, there is no reason to keep paying USD 62 a month.

DRS fits cases like these.

- **A server that cannot be rebuilt from code.** A machine configured by hand over years, or software whose installation steps no longer exist, can only be copied disk and all
- **Servers on premises or in another cloud that you want protected as they are.** Disaster recovery first, before anyone rewrites the application
- **A rebuild is too slow for the objective.** You may lose less data than the gap between snapshots, or you need to be back sooner than a rebuild allows

The first two are servers outside the way of building this book has recommended. Think of DRS as a tool for being ready for a disaster while still holding such servers. What can be rebuilt is cheaper to rebuild, with fewer moving parts.

Whichever you choose, a recovery procedure that has never been walked through is not readiness. The [deploy page](/en/chapters/40-disaster-recovery/deploy.md) of this chapter spends most of its length on drills.
