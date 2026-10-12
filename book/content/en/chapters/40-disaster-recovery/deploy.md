---
title: "40 Disaster Recovery: Deploy"
---

# 40 Disaster Recovery: Deploy

None of the steps on this page were run. The command arguments were checked against the help of the devShell's AWS CLI and against the documentation, nothing more. When you try them, remember the hourly charges and get to [the cleanup](/en/chapters/40-disaster-recovery/wrap.md) the same day.

## Getting replication started

<!-- section: 40.setup -->

First, prepare the VPC of chapter 11 and the instance of chapter 23. Pin the chapter 23 instance to an AMI whose kernel is 6.12 or older. The Amazon Linux documentation that chapter 23 refers to says AMIs with the version in their name, such as `kernel-6.1`, continue to be published.

```bash
vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages
aws ssm get-parameter --region ap-northeast-1 --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64 --query Parameter.Value --output text
vp run ec2:infra:deploy -c amiId=ami-xxxxxxxxxxxxxxxxx
vp run ec2:app:release
```

The parameter name on the second line is the one chapter 23 uses, with `default` replaced by `6.1`. It is the name the pinned CDK uses when it asks for the kernel 6.1 AMI, but I did not fetch the value to confirm it.

Next, deploy this chapter's stack. How to find the role's name and the security group's ID is under [The agent's permissions](/en/chapters/40-disaster-recovery/build.md).

<<< @/examples/40-disaster-recovery/infra/bin/app.ts{context}

```bash
vp run dr:infra:diff -c sourceRoleName=<role name> -c sourceSecurityGroupId=sg-xxxxxxxxxxxxxxxxx
vp run dr:infra:deploy -c sourceRoleName=<role name> -c sourceSecurityGroupId=sg-xxxxxxxxxxxxxxxxx
```

As in chapters 11 and 23, `-c` applies to that one command only. Deploy again later without `-c`, and the policy comes off the role, the rule for port 1500 disappears, and replication stops.

Of this stack's resource types, cdkd has dedicated providers for the security group, the roles, the policies, the function, the rule, and the log group. The interface endpoints and the outbound rule (`AWS::EC2::SecurityGroupEgress`) have none and go through Cloud Control API.

### Steps that exist only as API calls

Initializing the service and creating the two templates is done with the commands `vp run dr:plan` prints. Replace `<StagingSubnetId output>` with the value of the stack output `StagingSubnetId`.

```bash
vp run dr:plan kernel=6.1
aws drs initialize-service --region ap-northeast-1
```

Initialization needs preparation. According to the documentation, when you initialize from the console, the required roles are created at the moment you save the default replication settings. When you initialize through the API, you first create six roles yourself, attach AWS managed policies to them, and then call `initialize-service`. The role names, paths, and trusted services are on the initialization page of the documentation. For a first try, the console takes fewer steps. In that case set the subnet of the default template the console creates to the value of `StagingSubnetId`. The documentation also says only the account's administrator can initialize the service.

### Installing the agent

Open a session on the chapter 23 instance, fetch the arm64 installer, and run it.

```bash
vp run ec2:session
curl -o aws-replication-installer-init https://aws-elastic-disaster-recovery-ap-northeast-1.s3.ap-northeast-1.amazonaws.com/latest/linux_arm64/aws-replication-installer-init
chmod +x aws-replication-installer-init
sudo ./aws-replication-installer-init --region ap-northeast-1
```

Everything from the second line on runs inside the instance. The installer asks which disks to replicate. Pressing Enter selects all of them. The root disk is always replicated whether you select it or not. The installer creates a user named `aws-replication` and adds it to sudoers.

The documentation's example run is one where the installer asks for an access key. Whether it asks for nothing when an instance profile is used, or needs another argument, was not checked. The documentation also says a file for verifying the installer's hash is in the `aws-elastic-disaster-recovery-hashes-ap-northeast-1` bucket under the same path, with the extension `.sha512`.

There is a way that involves no manual installation. Select the instance in the EC2 console and add it to DRS as a source server, and the agent is installed through Systems Manager. The conditions are that Systems Manager manages the instance and that its role has the required permissions.

When the installation finishes, the installer prints the source server's ID (it starts with `s-`) and the initial sync begins.

### Setting the launch template

When the source server registers, DRS creates one EC2 launch template. The VPC of chapter 11 is not a default VPC, so without a subnet the launch fails. Set these four from the source server's page in the DRS console.

- Subnet: the value of the stack output `StagingSubnetId`
- Instance type: `t4g.micro`. Anything that is not Graviton fails the check before the launch
- Security group: the one the chapter 23 instance uses
- Instance profile: the one the chapter 23 instance uses. You need it to open a Session Manager session on the launched instance

Leave the template's name and its device names alone.

This task shows how the sync is going.

```bash
vp run dr:status --rpo 600
```

`--rpo` is the RPO you set, in seconds. Until the initial sync finishes, the server is shown as `BLOCKED`.

## The drill

<!-- section: 40.drill -->

A recovery procedure that was never walked through is a procedure you hope will work. The DRS documentation recommends a drill at least once a quarter. A drill affects neither the original server nor the replication in progress.

```figure
caption: One drill runs from asking for a launch to confirming the termination, and what decides the verdict is the checks after the launch
type: sequence
actor you: You
actor drs: DRS
actor ri: Drill instance
actor src: Source
step you -> src: write a marker note
note you: record declaredAt
step you -> drs: dr:status
step you -> drs: dr:drill --apply
step drs -> ri: launch from a snapshot
step you -> drs: dr:job
step you -> ri: check over SSM
note you: record verifiedAt
step you -> drs: dr:terminate --apply
step drs -x ri: terminate
step you -> drs: dr:billed
```

The steps, in order.

First, write one note on the original instance to serve as a marker. `vp run ec2:smoke` from chapter 23 creates a note titled `smoke`. Write down the time. That time is "the moment the disaster is declared", and goes into the record as `declaredAt`.

Then look at the plan.

```bash
vp run dr:status --rpo 600
vp run dr:drill --rpo 600
```

The second line only prints the request for `StartRecovery` and launches nothing. Read it, then add `--apply`.

```bash
vp run dr:drill --rpo 600 --apply
vp run dr:job --job drsjob-xxxxxxxxxxxxxxxxx
```

These are the flags.

<<< @/examples/40-disaster-recovery/scripts/dr.ts{flags}

`dr:job` prints the state of the job and the launch status of each server. A job that is `COMPLETED` has not necessarily launched anything successfully. The task ends in success only when every server is `LAUNCHED`. How long a launch takes was not measured.

<<< @/examples/40-disaster-recovery/scripts/dr.ts{commands}

### What to check on the launched instance

Open a Session Manager session on the instance ID that `dr:job` printed. The tasks of chapter 23 address the instance of the chapter 23 stack, so here the CLI is used directly.

```bash
aws ssm start-session --region ap-northeast-1 --target i-xxxxxxxxxxxxxxxxx
systemctl is-active notes.service
mountpoint /var/lib/notes
curl -fsS http://127.0.0.1:8787/health
curl -fsS http://127.0.0.1:8787/notes
readlink /opt/notes/current
```

Everything from the second line on runs inside the instance. Look for these.

- The service is `active`
- `/var/lib/notes` is a mount point. If it is not, notes are being read from an empty directory on the root volume
- `/health` answers 200
- The answer of `/notes` contains the marker note written before the drill. If it does not, the instance was launched from a point before the marker
- `/opt/notes/current` points at the release you expect

Also check in the EC2 console that both status checks of the instance have passed. These six correspond to the list of checks under [Deciding a drill](/en/chapters/40-disaster-recovery/build.md).

Whether the data volume mounts correctly on the drill instance is the point of this chapter that most needs checking on a real instance. Chapter 23 writes `/etc/fstab` by UUID, so if the disks are replicated whole it should mount, but this was not tried.

A drill instance is a second machine running the same app as production with the same settings. The notes app listens on `127.0.0.1` only and calls no outside service, so it does no harm. On a server with a worker that reads a queue, or a batch job that calls an external API, the drill instance would take production's work. The documentation says to adjust the launch settings to isolate drill instances when necessary.

### Ending it, and leaving a record

When the checks are done, terminate the drill instance.

```bash
vp run dr:terminate
vp run dr:terminate --apply
vp run dr:billed
```

`dr:terminate` selects only instances launched as drills. It does not even list an instance launched for a real recovery. The documentation says DRS cleans up the previous drill instance when the same source server is drilled again. Do not rely on that; terminate every time.

What a drill leaves is a record. Copy `examples/40-disaster-recovery/drill/record.template.json` and fill in the times and the results of the checks.

<<< @/examples/40-disaster-recovery/src/drill.ts{record}

The summary measures the actual RTO from "the moment the disaster is declared" to "the moment the checks were done", not to the moment the launch ended. The actual RPO runs from the moment of the disaster back to the point the launch used. A time left empty makes its measure "not measured". An empty termination time is reported as cleanup not done.

Drill when a setting changes, when the operating system or the app changes in a large way, and on a schedule even when nothing changed. A successful drill last time guarantees nothing about the next launch once the kernel has been updated since.

## A real failover, and the way back

<!-- section: 40.failover -->

What you do to DRS in a real recovery is what you do in a drill. The differences are that `isDrill` in `StartRecovery` is false, and that the launched instance is not terminated. This chapter's script has no command that starts a real recovery. The two entrances are kept apart so that nobody starts a production recovery while meaning to drill. A real recovery is started from the DRS console or with `aws drs start-recovery`.

From there on it is not DRS's work. Of the four steps under [The order of a recovery](/en/chapters/40-disaster-recovery/build.md), DRS performs the first.

**Check.** Run the same six checks as in a drill. In a disaster, choosing the most recent data means waiting for a connection to the source, so you also have to decide whether to take an existing snapshot instead.

**Stop the original server.** If the original server may be alive, put it in a state where it accepts no writes before you switch: stop the instance, or cut its traffic with a security group. When the whole zone is down and out of reach, make sure it does not start working on its own when it returns.

**Redirect clients.** The notes API of chapter 23 has no public address, and clients connected by forwarding a port with `vp run ec2:forward`. What changes is therefore the instance ID the forward points at. In a real service you switch a DNS record or a load balancer's target. Route 53 health checks and failover are covered in [chapter 28](/en/chapters/28-multi-region.md). The DRS documentation also says the redirection is not done by DRS, and suggests considering Route 53.

While a recovery instance is running, do not disconnect its source server. Disconnecting discards all the points in time of the original server, according to the best practices page.

### Ending the unprotected state quickly

Right after the switch, the recovery instance is replicated nowhere. If another failure comes, there is nowhere to return to this time.

For a cross-zone setup the documented steps are these. Change the subnet in the replication settings and in the launch template to one in the original zone, and perform "protect recovered instance" on the recovery instance. Replication from the recovery instance to the original zone begins, and replication from the original instance stops. The documentation says this replication is not a sync from the beginning but a rescan of the differences from the last snapshot.

For a cross-Region setup, you start reversed replication from the recovery instance. A new source server is created in the original Region. All the data is sent again from the beginning, which takes time and inter-Region data transfer charges.

### Failback

Returning to the original place is called failback. The steps mirror the failover. Once the reversed replication has caught up, you launch an instance in the original place, check it, and redirect clients back.

There are two places to launch the returning instance. One is a new instance, and the other is the original instance itself. The latter is the setting called "launch into source instance". Its conditions include the tag `AWSDRS=AllowLaunchingIntoThisInstance` on the original instance and the same architecture. An arm64 server can fail back only within AWS.

What must not be forgotten about failback is its direction. Reversed replication replaces the original disks with the contents of the recovery side's disks. Writes that existed only on the original server disappear at that moment. The procedure for counting what will disappear first is under [The distributed view](/en/chapters/40-disaster-recovery/wrap.md).

After failback, things that are no longer needed remain on both sides: the recovery instance, the source server created for the reversed replication, and the original instance. The documentation spells out the order of cleanup. Stopping replication comes first, terminating instances after.
