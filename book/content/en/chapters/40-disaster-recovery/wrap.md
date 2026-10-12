---
title: "40 Disaster Recovery: Costs, Pitfalls, and Cleanup"
---

# 40 Disaster Recovery: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It covers how to read RPO and RTO, the traps that appear when two sites are seen as a distributed system, how platforms without servers differ, where people get stuck, and the cleanup.

## RPO and RTO are yours to measure

<!-- section: 40.objectives -->

RPO was how much data you may lose, and RTO how long getting back may take (chapter 22).

The DRS documentation gives numbers: an RPO typically in the sub-second range, and an RTO typically between 5 and 20 minutes. Both come with "typically", and both are the service describing itself. The conditions are stated alongside. The RPO stays within seconds only while the network and the staging area can carry data faster than the source writes it to disk. When writes outrun that, the lag grows. The RTO, it also says, depends heavily on how long the operating system takes to boot.

You cannot take these numbers as your own system's objectives or results, for three reasons.

The first is how the number is measured. The documentation's RPO counts up to the point that was written to disk and arrived in the staging area. Data that was in memory and had not reached the disk was never in the count.

The second is what the RTO covers. If the instance is up in 20 minutes, the time after that, for checking, stopping the original server, redirecting clients, and waiting for a DNS change to spread, lies outside DRS's number. So do the time until someone notices the disaster and the time until someone decides to recover. In many cases the long part is people deciding.

The third is the environment. Replication servers are replaced roughly every 14 days, and the FAQ says lag may appear while that happens. Lag also changes when the source's kernel is updated, when a disk is added, and when a rescan occurs.

So you set the objectives yourself and measure the results in drills. The two values a drill record produces are those results.

**This book measured nothing.** DRS was never run, so there is no RPO or RTO figure to show for this setup. The times `vp run dr:demo` prints were chosen for the explanation.

## The distributed view

<!-- section: 40.distributed -->

With DRS in place, the system is two sites and one replication stream between them. The question is which side holds the correct data at each moment.

Before a disaster, the original server is the truth. The staging area is a copy that is in the past by the lag.

After a failover, the recovery instance is the truth. Its contents are whatever had arrived in the staging area. A write the original server answered 201 to, and that had not yet arrived, is not in the new truth. That loss is fixed at the moment of the failover. RPO is the length of that loss.

The trouble comes afterwards.

```figure
caption: When the original server returns and takes writes, each side holds writes the other does not know, and failback silently erases those of the original side
type: sequence
actor client: Clients
actor src: Source | zone 1
actor stg: Staging area
actor ri: Recovery instance | zone 2
step client -> src: write A (201)
step src -> stg: replicate A
step client -> src: write B (201)
note src: goes down before B arrives
step stg --> ri: launch (holds A only)
step client -> ri: write C (201)
note src: comes back, not fenced
step client -> src: write D (201)
note src: split brain
step ri -> src: failback (overwrite)
note src: B and D are gone
```

A zone failure is usually temporary. The original server comes back sooner or later. If even one client still remembers the old address then, the original server takes its write and answers 201. The recovery instance is taking writes too. Two sites each believe they are production. That state is called split brain.

Block-level replication has no means of merging two disks. Failback replaces the original disks with the recovery side's. B and D, which existed only on the original side, disappear there. And DRS reports nothing, because from where it stands it replicated exactly as told.

The invariant to protect is one sentence. **After failback, no write acknowledged by either site is lost silently.** It does not say no write is lost. B was lost at the moment of the disaster. What it asks is that every lost write is either back or written down.

Two sites in memory make the invariant checkable.

<<< @/examples/40-disaster-recovery/src/sites.ts{failback}

The first method copies what DRS does. The second puts two questions before the same overwrite, questions DRS will not answer for you. Has the original server been stopped? And what does the original server hold that the recovery side lacks?

While the original server is accepting writes, the failback does not start. After it is stopped, its data is read, and what the recovery side lacks is counted and recorded. When the disks are lost and cannot be read, the writes cannot be named, so a range is recorded instead: everything the original server acknowledged after the point that was recovered.

This is how the invariant is judged.

<<< @/examples/40-disaster-recovery/src/sites.ts{invariant}

The tests try to break it. Replication lag, the original server's return, a forgotten fence, and writes from stale clients are mixed by a seeded random generator into five orders, and the failback that keeps a record holds the invariant in each. The tests also show that with the failback that only overwrites, there are orders that break it.

In the real notes app, "read the original server's data" means taking `notes.json` off the data volume of the stopped instance and comparing it by ID with the recovery side's. This chapter has no code for that work. What the model shows is the order, and the promise to leave a record.

The way to prevent split brain is to stop the original server before switching. That is why [the order of a recovery](/en/chapters/40-disaster-recovery/build.md) has a `fence-source` step. When a whole zone is down, though, the operation that stops the server does not reach it. Then you arrange that the returning server cannot start working on its own. For the chapter 23 instance it is enough that, once the address has been switched, nobody forwards a port to the old instance. A public service needs a mechanism: taking the old side out of the load balancer, closing it with a security group, or asking something outside "am I production?" at startup.

## On platforms without servers

<!-- section: 40.platforms -->

A reader coming from Cloudflare Workers has nothing that corresponds to this chapter. Workers code runs not on a virtual machine but in isolates across Cloudflare's network, and a request is handled by the data center that receives it, says the documentation (as of 2026-10-13). There is no server with a disk to replicate, and no Region the developer picks and fails over from.

Vercel does have regions. Functions run in the regions set for the project and have redundancy across several availability zones by default, according to its documentation. On the Enterprise plan you can set where to fail over to when a region is unavailable. Even so, there is no server to install an agent on and replicate the disk of, so nothing like DRS is needed.

On both platforms, the questions of chapters 22 and 28 remain for wherever the data lives. If you have no servers, the work of this chapter never arises. That is reason enough to choose that side.

## Where people get stuck

**The kernel is too new.** As the chapter's opening says, the default AMI of chapter 23 is not supported. What happens when the kernel is updated after the agent is installed was not checked. Read the support list before the patch procedure of chapter 23 raises the kernel.

**Replication does not start.** With a path missing, the agent installs and the initial sync never advances. Check the 443 paths with `vp run dr:plan`, and the outbound rule for 1500 in the chapter 23 security group. The source server's page in the DRS console shows at which step of starting replication it stopped.

**The drill instance does not launch.** Suspect first a launch template without a subnet, or an instance type that is not Graviton.

**Charges continue after stopping the instance.** With the original instance stopped, the source server stays registered, and both the DRS fee and the staging area's charges continue. They stop when you stop replication or disconnect.

**Stopping replication erases the points in time.** "Stop replication" stops the charges and deletes every snapshot taken so far. Starting again begins with the initial sync.

**Deploying again without `-c`.** The policy comes off the role and the rule for 1500 disappears. No error appears, and replication stops some time later.

**Quotas.** One account and Region can replicate up to 300 source servers, and that value cannot be raised (the list as read on 2026-10-13). Twenty jobs can be in progress at once, and one job per source server.

## For production

- **Tell a person when replication stops.** This chapter's stack only writes a log. Connect the error lines to a notification with the metric filter and alarm of chapter 19. DRS also publishes the lag and the backlog as CloudWatch metrics
- **Cross a Region.** This chapter only crosses zones. The documentation recommends cross-Region replication against Region-level events. That needs a VPC, endpoints, and initialization in the recovery Region, and adds data transfer charges
- **Protect the snapshots.** Someone who gets into the account can delete the point-in-time snapshots too. The best practices page says extra measures are needed. Keep a long-lived backup in another account, apart from DRS (chapter 22)
- **Give the staging area its own subnet.** This is what the documentation recommends
- **Move the settings into the chapter 23 stack.** The policy and the rule for 1500 belong in the stack that owns the instance
- **Put drills on the calendar.** At least once a quarter, and whenever a setting or the operating system changes. Keep the records so the next drill can be compared with them
- **Write the switch procedure down.** Who decides to recover, which point is chosen, how the original server is stopped, how the address is switched. These are not things to work out in the middle of a disaster

## Cleanup

<!-- section: 40.cleanup -->

Cleanup has an order. The DRS side first, then the stack.

```bash
vp run dr:terminate --apply
aws drs disconnect-source-server --region ap-northeast-1 --source-server-id s-xxxxxxxxxxxxxxxxx
aws drs delete-source-server --region ap-northeast-1 --source-server-id s-xxxxxxxxxxxxxxxxx
vp run dr:billed
vp run dr:infra:destroy
```

The first line terminates the drill instances, because a source server that still has a recovery instance cannot be disconnected.

The second line is the one that stops the charges. According to the API reference, disconnecting stops replication immediately, and the resources created for replication (the replication server, the staging disks, the snapshots) are deleted within 90 minutes. The agent, if it can still talk to DRS, receives a command to uninstall itself within about 10 minutes. Until you disconnect, the DRS fee and the staging area's charges continue even with the instance stopped.

The third line deletes the source server's record. Only a disconnected server can be deleted.

The fourth line lists what is still billed, as far as the DRS API can see.

<<< @/examples/40-disaster-recovery/src/billing.ts{billed}

This list sees only what two DRS APIs return. When it shows nothing left, the task also prints what it cannot see. Right after a disconnect the resources may not have been deleted yet, so the line reads "winding-down".

The fifth line destroys this chapter's stack. The interface endpoints stop being billed, the policy comes off the chapter 23 role, and the rule for 1500 disappears. Destroy this chapter's stack before the chapter 23 stack. IAM should refuse to delete a role that still has another stack's policy attached (not checked).

After that, clean up chapters 23 and 11, each in its own chapter's order.

Confirm for yourself that everything is gone.

```bash
aws drs describe-source-servers --region ap-northeast-1
aws drs describe-recovery-instances --region ap-northeast-1
aws ec2 describe-instances --region ap-northeast-1 --filters Name=instance-state-name,Values=pending,running,stopping,stopped
aws ec2 describe-volumes --region ap-northeast-1
aws ec2 describe-snapshots --region ap-northeast-1 --owner-ids self
aws ec2 describe-vpc-endpoints --region ap-northeast-1
```

If, 90 minutes after the disconnect, the third still shows a replication server, or the fourth and fifth still show staging volumes or snapshots, delete them by hand. Staging area resources should carry the tag given in the template (`aih:chapter=40`).

Three things remain: the IAM roles created at initialization, the replication and launch configuration templates, and the storage created by cdkd's bootstrap (chapter 02). Neither the pricing page nor the Price List mentions a charge for the roles or the templates. I found no operation in the documentation that undoes the initialization of DRS.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (the drill plan and verdict, the summary of a drill record, a recovery order failing in the middle and resumed, the two-site model and split brain, validation of DRS events, API response shapes and the still-billed list, the model of source conditions and paths, the contents of the two templates and the CLI commands, pricing inputs, stack assertions). Type check. `dr:infra:synth` (default, `-c placement=public`, `-c templates=declare`, `-c sourceRoleName=... -c sourceSecurityGroupId=sg-0123456789abcdef0`). `dr:demo`. `dr:plan` (by default it reports kernel 6.18 as unsupported and exits with 2; also `kernel=6.1` and `placement=public`). The arguments of each `aws drs` command were read in the help of AWS CLI 2.35.11 in the devShell. The amounts in the text are computed by `tools/src/pricing/calc.ts` from Price List unit prices, and `examples/40-disaster-recovery/test/pricing.test.ts` compares them with the numbers in the text.

**Not checked yet.** Nothing was run against AWS. That covers every one of `dr:infra:diff`, `dr:infra:deploy`, `dr:infra:drift`, `dr:infra:destroy`, `dr:status`, `dr:drill`, `dr:job`, `dr:terminate`, and `dr:billed`. DRS was never initialized, no template was created, no agent installed, and no drill, recovery, failback, or disconnect performed. There are therefore no measured RPO or RTO values. All of the following also wait for a real run. That cdkd 0.296.28 can create and delete this stack (the interface endpoints and `AWS::EC2::SecurityGroupEgress` go through Cloud Control API). That a policy attaches to another stack's role, and what chapter 23's drift check then shows. That the agent works with this chapter's policy, which is the AWS policy with permissions removed. That the installer succeeds on Graviton Amazon Linux 2023, and what arguments it takes with an instance profile. That the agent obtains credentials with IMDSv2 required and a hop limit of 1. That the endpoint behind private DNS works without `--endpoint`. That the S3 gateway endpoint alone delivers the installer and the replication server's software. That the DRS security group accepts port 1500. The real format of `lagDuration`. The real shape of the events that reach EventBridge. Setting the launch template, and the data volume mounting on a drill instance. That the parameter `al2023-ami-kernel-6.1-arm64` can be fetched. How long after a disconnect the charges stop.

What could not be confirmed from primary sources. The presence of `AWS::DRS` resource types was looked at only in the per-Region definitions downloaded on 2026-10-13 (seven of them: us-east-1, us-west-2, ap-northeast-1, ap-northeast-3, us-east-2, eu-west-1, ap-southeast-1); other Regions were not examined. The CloudFormation registry was not queried (that needs credentials). The format of `lagDuration` is not in the API reference. For the schema of DRS events, only the samples in the user guide were read. The size and type of the replication server's root volume, and the default volume type of a drill instance, were not found in the documentation, and are either left out of the cost or marked as assumptions. The statement that staging disks are magnetic applies to disks of 125 GiB or less, and together with the real size of the snapshots it has to be checked against a bill. Neither the pricing page nor the Price List says whether DRS has a free tier. I found no page stating that the agent supports IMDSv2. For Cloudflare and Vercel, one page each was read.

Resource types cdkd handles. Reading the installed cdkd 0.296.28, dedicated providers are registered for `AWS::EC2::SecurityGroup`, `AWS::Events::Rule`, `AWS::IAM::ManagedPolicy`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, and `AWS::Logs::LogGroup`. `AWS::EC2::VPCEndpoint`, `AWS::EC2::SecurityGroupEgress`, `AWS::DRS::ReplicationConfigurationTemplate`, and `AWS::DRS::LaunchConfigurationTemplate` are not registered and go through Cloud Control API. The stack's tests pin the list of types the default layout uses.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| What it costs just to exist | `examples/40-disaster-recovery/src/cost.ts`, `scripts/plan.ts`, `test/pricing.test.ts`, `data/pricing/` | `dr:plan`, `test:unit` |
| The whole picture | `examples/40-disaster-recovery/infra/lib/dr-stack.ts`, `infra/bin/app.ts`, `src/config.ts` | `dr:infra:synth` |
| What a source server has to be | `examples/40-disaster-recovery/src/source.ts`, `test/plan.test.ts` | `dr:plan`, `test:unit` |
| The paths the agent needs | `examples/40-disaster-recovery/src/network.ts`, `infra/lib/dr-stack.ts`, `test/plan.test.ts`, `examples/11-network/src/reach.ts` | `dr:plan`, `test:unit` |
| The agent's permissions | `examples/40-disaster-recovery/infra/lib/dr-stack.ts`, `infra/test/dr-stack.test.ts` | `test:unit`, `dr:infra:synth` |
| What can be declared, and what cannot | `examples/40-disaster-recovery/src/templates.ts`, `infra/lib/dr-stack.ts`, `infra/test/dr-stack.test.ts` | `dr:plan`, `dr:infra:synth`, `test:unit` |
| Deciding a drill | `examples/40-disaster-recovery/src/drill.ts`, `src/drs.ts`, `src/adapter.ts`, `test/drill.test.ts`, `test/billing.test.ts`, `test/fixtures.ts` | `test:unit` |
| The order of a recovery | `examples/40-disaster-recovery/src/order.ts`, `test/order.test.ts` | `test:unit`, `dr:demo` |
| Receiving DRS events | `examples/40-disaster-recovery/src/events.ts`, `src/events-lambda.ts`, `test/events.test.ts` | `test:unit` |
| Run it locally | `examples/40-disaster-recovery/scripts/demo.ts`, `scripts/plan.ts` | `dr:demo`, `dr:plan`, `test:unit`, `dr:infra:synth` |
| Getting replication started | `examples/40-disaster-recovery/infra/bin/app.ts`, `src/templates.ts`, `tools/src/infra/` | `dr:infra:diff`, `dr:infra:deploy`, `dr:plan`, `dr:status` |
| The drill | `examples/40-disaster-recovery/scripts/dr.ts`, `src/drill.ts`, `drill/record.template.json` | `dr:status`, `dr:drill`, `dr:job`, `dr:terminate` |
| A real failover, and the way back | `examples/40-disaster-recovery/src/order.ts`, `src/sites.ts` | `dr:status` |
| The distributed view | `examples/40-disaster-recovery/src/sites.ts`, `test/sites.test.ts`, `scripts/demo.ts` | `test:unit`, `dr:demo` |
| Cleanup | `examples/40-disaster-recovery/src/billing.ts`, `scripts/dr.ts`, `test/billing.test.ts` | `dr:terminate`, `dr:billed`, `dr:infra:destroy` |

**Primary sources** (all checked on 2026-10-13)

- Elastic Disaster Recovery user guide: [What is Elastic Disaster Recovery?](https://docs.aws.amazon.com/drs/latest/userguide/what-is-drs.html), [Initialization and permissions](https://docs.aws.amazon.com/drs/latest/userguide/getting-started-initializing.html), [Supported AWS Regions](https://docs.aws.amazon.com/drs/latest/userguide/supported-regions.html), [Network diagrams](https://docs.aws.amazon.com/drs/latest/userguide/Network-diagrams.html), [Network setting preparations](https://docs.aws.amazon.com/drs/latest/userguide/Network-Settings-Preparations.html), [Network requirements](https://docs.aws.amazon.com/drs/latest/userguide/Network-Requirements.html), [Installing the agent on a secured network](https://docs.aws.amazon.com/drs/latest/userguide/installing-agent-blocked.html), [Amazon EBS volumes](https://docs.aws.amazon.com/drs/latest/userguide/volumes-drs.html), [Security groups](https://docs.aws.amazon.com/drs/latest/userguide/drs-security-group.html), [Data routing and throttling](https://docs.aws.amazon.com/drs/latest/userguide/data-routing.html), [Point in time (PIT) policy](https://docs.aws.amazon.com/drs/latest/userguide/point-in-time.html), [Supported Linux operating systems](https://docs.aws.amazon.com/drs/latest/userguide/Supported-Operating-Systems-Linux.html), [Generating the required AWS credentials](https://docs.aws.amazon.com/drs/latest/userguide/credentials.html), [Using an instance profile for agent installation in AWS](https://docs.aws.amazon.com/drs/latest/userguide/agent-installations-in-aws.html), [Installing the AWS Replication Agent on Linux](https://docs.aws.amazon.com/drs/latest/userguide/linux-agent.html), [Adding instances from the Amazon EC2 Console](https://docs.aws.amazon.com/drs/latest/userguide/adding-servers-from-aws-instances.html), [Key considerations for EC2 launch templates](https://docs.aws.amazon.com/drs/latest/userguide/ec2-key-considerations.html), [Launch into source instance](https://docs.aws.amazon.com/drs/latest/userguide/default-drs-launch-into-source-instance.html), [Post-launch actions](https://docs.aws.amazon.com/drs/latest/userguide/post-launch-action-settings-overview.html), [Source networks](https://docs.aws.amazon.com/drs/latest/userguide/source-networks.html), [Recovery plans](https://docs.aws.amazon.com/drs/latest/userguide/recovery-plans.html), [Recovery and failback](https://docs.aws.amazon.com/drs/latest/userguide/failback.html), [Preparing for recovery](https://docs.aws.amazon.com/drs/latest/userguide/preparing-failover.html), [Performing a failover](https://docs.aws.amazon.com/drs/latest/userguide/failback-preparing-failover.html), [Performing a failback](https://docs.aws.amazon.com/drs/latest/userguide/failback-performing-main.html), [Cross-Region failback](https://docs.aws.amazon.com/drs/latest/userguide/failback-failover-region-region.html), [Cross Availability Zone recovery](https://docs.aws.amazon.com/drs/latest/userguide/failback-failover-cross-availability-zone-failback.html), [Command menus](https://docs.aws.amazon.com/drs/latest/userguide/command-menus.html), [Best practices](https://docs.aws.amazon.com/drs/latest/userguide/best_practices_drs.html), [Alarm events and EventBridge](https://docs.aws.amazon.com/drs/latest/userguide/monitoring-event-bridge.html), and the FAQ pages [Concepts](https://docs.aws.amazon.com/drs/latest/userguide/CloudEndure-Concepts.html) and [Replication](https://docs.aws.amazon.com/drs/latest/userguide/Replication-Related-FAQ.html)
- API and permissions: [StartRecovery](https://docs.aws.amazon.com/drs/latest/APIReference/API_StartRecovery.html), [DisconnectSourceServer](https://docs.aws.amazon.com/drs/latest/APIReference/API_DisconnectSourceServer.html), [DataReplicationInfo](https://docs.aws.amazon.com/drs/latest/APIReference/API_DataReplicationInfo.html), [AWSElasticDisasterRecoveryEc2InstancePolicy](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSElasticDisasterRecoveryEc2InstancePolicy.html), [Endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/drs.html), [AWS services that integrate with PrivateLink](https://docs.aws.amazon.com/vpc/latest/privatelink/aws-services-privatelink-support.html), and the type definitions of `@aws-sdk/client-drs` 3.1149.0
- CloudFormation and tools: [Resource provider schemas](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/resource-type-schemas.html) (the per-Region zips were downloaded and inspected), the `aws-drs` type definitions of `aws-cdk-lib` 2.273.0, and the contents of `@go-to-k/cdkd` 0.296.28
- Pricing: [AWS Elastic Disaster Recovery pricing](https://aws.amazon.com/disaster-recovery/pricing/), and the AWS Price List bulk API for [Elastic Disaster Recovery](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSElasticDisasterRecovery/current/ap-northeast-1/index.json) and [EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.csv) (the CSV, filtered by usage type)
- Compared with: [AWS Elastic Disaster Recovery FAQs](https://aws.amazon.com/disaster-recovery/faqs/), [AWS Backup: backup plan options](https://docs.aws.amazon.com/aws-backup/latest/devguide/plan-options-and-configuration.html), [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/), [Configuring regions for Vercel Functions](https://vercel.com/docs/functions/configuring-functions/region)

:::
