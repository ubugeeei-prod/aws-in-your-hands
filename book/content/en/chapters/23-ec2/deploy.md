---
title: "23 VM: Deploy"
---

# 23 VM: Deploy

This page deploys the stack and installs the application, and then covers the snapshots and patches that operating the machine requires. As the page [Run It Locally](/en/chapters/23-ec2/local.md) said, the commands on this page have not been run against real AWS yet.

## Deploying, and getting into the instance

<!-- section: 23.deploy -->

The deploy has an order. The chapter 11 VPC comes first, and this chapter's stack comes second. The steps here use the default layout.

```bash
vp run ec2:plan
vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages
vp run ec2:infra:diff
vp run ec2:infra:deploy
```

Hourly charges begin with the second line. To try the cheaper layout, drop `-c` from the second line and add `-c placement=public` to the fourth. In that case, add the same `-c` to every later `ec2:infra:` command as well. If you deploy without it, the instance is created again in the private subnet.

When the deploy finishes, the user data script is still running. Wait a few minutes and then check the state.

```bash
vp run ec2:status
```

The task prints the instance's state as Systems Manager sees it, the cloud-init result, the state of the service, and the mount of the data volume. If the instance's state is `Online`, the path and the permissions work. At this point the service is enabled but not running, because there is no application yet.

### Installing the application

```bash
vp run ec2:app:release
```

This task builds the API, puts it in S3, and tells the instance to fetch it. It tells the instance through Run Command, which sends a command and receives its result over the same path as Session Manager.

Each release gets a name.

<<< @/examples/23-ec2/src/release.ts{version}

The name consists of the build time and the first 16 digits of the content's hash. On the instance, a script that user data installed receives the name.

<<< @/examples/23-ec2/deploy/notes-release.sh

The arguments come from outside, so the script checks their shape first and ends without doing anything if they do not match. Next it compares the hash of the file fetched from S3 with the hash in the name, so that it never starts a truncated file or a different file. Then it repoints a link called `current` at the new version, restarts the service, and waits for `/health` to answer. If there is no answer, the script ends in failure, and so does the task.

Old versions stay on the instance, so going back to an earlier version only takes repointing the link.

```bash
vp run ec2:app:rollback 20261012T010203Z-0123456789abcdef
```

Use a version name that `ec2:app:release` printed. Nothing rolls back automatically. You decide whether to go back.

Every command sent to the instance is assembled by this function.

<<< @/examples/23-ec2/src/remote.ts{commands}

### Checking that it works

```bash
vp run ec2:smoke
vp run ec2:logs
```

`ec2:smoke` runs `curl` on the instance, creates one note, and lists the notes. The API cannot be called from outside the instance, so the task calls it from inside.

To call the API from `curl` or a browser on your machine, use port forwarding.

```bash
vp run ec2:forward
curl -s http://localhost:8787/health
```

While the first line is running, port 8787 on your machine is connected to port 8787 on the instance. Nothing was added to the security group. For an interactive shell, use `vp run ec2:session`.

`ec2:forward` and `ec2:session` need the Session Manager plugin in addition to the AWS CLI. The devShell does not include it, so install it by following the AWS documentation. Without the plugin you can still open a shell from Session Manager in the management console, and `ec2:status`, `ec2:smoke`, `ec2:logs`, and `ec2:app:release` work without it.

The section [No SSH port](/en/chapters/23-ec2/build.md) said that IAM decides who may get in. It follows that anyone who is allowed `ssm:StartSession` or `ssm:SendCommand` is an administrator of this machine. Run Command runs its commands with administrative permissions, and the session user (`ssm-user`) can use `sudo`. Treat these two permissions as carefully as you would an SSH key.

The drift check is the same as in chapter 02.

```bash
vp run ec2:infra:drift
```

When these commands are run against real AWS for the first time, the thing to watch is how cdkd behaves. Of the resource types in this stack, cdkd has its own implementation for the instance, security group, instance profile, role, and bucket. It has none for the volume and the volume attachment, which go through Cloud Control API. Reading the chapter 11 VPC outputs through `Fn::ImportValue` would also be run for the first time. These are the points to verify first.

## Snapshot and restore

<!-- section: 23.backup -->

There is only one data volume, so every note is lost if it breaks. A snapshot is the safeguard. It is a copy of the volume at a point in time, it is kept in S3, and it can be restored as a volume in any zone of the Region. Snapshots are incremental, so from the second one on only the changes are stored.

For the procedure in this section, too, only the flags of the commands were checked, against the help of the AWS CLI in the devShell.

### Taking a snapshot

```bash
vp run ec2:data:unmount
aws ec2 create-snapshot --region ap-northeast-1 --volume-id vol-xxxxxxxxxxxxxxxxx --description "notes before the upgrade"
vp run ec2:data:mount
```

The volume ID is the stack output `DataVolumeId`.

Copying a volume while it is being written to can capture a half-finished state, so the first line stops the service and unmounts the volume beforehand. A snapshot captures the contents as they were when it started, so you do not need to wait for it to complete. Once its state is `pending`, the third line can mount the volume again and start the service. The API is down from the first line to the third.

`ec2:data:mount` runs the same script as the first boot, and it makes the same decision not to format.

### Restoring from a snapshot

The simplest way is to let the stack create the volume from the snapshot.

```bash
vp run ec2:infra:deploy -c dataSnapshotId=snap-xxxxxxxxxxxxxxxxx
```

If the stack has been destroyed, this command creates the instance and a volume that holds the snapshot's contents. The first-boot script sees the file system and mounts it without formatting. After that, running `vp run ec2:app:release` brings the notes back. The same method works when a zone has become unusable, because you can restore into another zone if the chapter 11 VPC has a subnet there. This chapter's stack is fixed to the first zone, however, so that needs a code change.

Adding `dataSnapshotId` to a running stack is a different situation. In the CloudFormation documentation, a volume's `SnapshotId` is a property that cannot be updated. In the cdkd source the change replaces the volume, and because that deletes the old volume, cdkd refuses it unless `--force-stateful-recreation` is given. This path was only read in the source and was not run.

A volume created from a snapshot can be slow at first, because its contents are fetched from S3 only when they are first read.

It is easy to forget that a snapshot is not a resource of the stack. It remains after the stack is destroyed and keeps costing money. The [cleanup](/en/chapters/23-ec2/wrap.md) checks whether any are left.

## Patching

<!-- section: 23.patch -->

With Lambda, patching the operating system was AWS's job. With EC2 it is yours.

An Amazon Linux 2023 instance is **locked** to the package versions that existed when its AMI was built. Running `dnf upgrade` brings nothing new, and security updates are not applied automatically either. It is built this way so that the same command gives the same result last month and this month.

If you do nothing, then, the machine stays as it was on the day it started and grows old. There are two ways to patch it.

One is to upgrade the running instance in place. You check whether a newer release exists and upgrade to it by name.

```bash
vp run ec2:patch:check
vp run ec2:patch:apply 2023.12.20260930
```

The argument on the second line is a version that the first line printed. `latest` is not accepted. The Amazon Linux documentation also says that asking for `latest` means trying an untested update in production first. If the kernel was updated, the old kernel keeps running until a reboot, so reboot with `aws ec2 reboot-instances`. The API is down while that happens.

The other is to replace the instance with one built from a newer AMI. Deploy with the new ID in `-c amiId=`, described in the section [Choosing an AMI](/en/chapters/23-ec2/build.md). User data runs from the beginning and the data volume is attached again, and then you install the release once more. No trace of manual changes remains, so the result is easier to predict. The Amazon Linux documentation recommends this way as well.

One thing about replacement is unknown, though. How the volume attachment behaves during a replacement could not be worked out from the cdkd source. It is unclear whether cdkd detaches the volume from the old instance and then attaches it to the new one, or fails partway. Until it has been tried on real AWS, this way is only expected to work. Take a snapshot first when you try it.

Systems Manager also has a feature called Patch Manager. It finds missing patches, applies them, and lists which machines are compliant, and you will need it once there are many machines. Note that, according to the documentation, Patch Manager ignores the Amazon Linux 2023 version lock and always uses the latest repositories. This chapter does not configure it.

### Staying replaceable

Patching by replacement, taken further, leads to an Auto Scaling group. You give it a recipe for the instance (a launch template) and a count, and it replaces an instance that becomes unhealthy with a new one. With a count of one, keeping one machine present at all times becomes AWS's job.

This chapter does not build one. If replacement happens automatically, everything a replacement requires has to be automatic too. In the current layout, attaching the data volume again and installing the release again both need a person. Whether automating that far is worth it is a decision to make together with the conditions in the section [One machine is a single point of failure](/en/chapters/23-ec2/wrap.md).

### What is yours on a long-lived machine

- **Patches for the operating system and the runtime.** Node.js is an operating system package too, so it is upgraded the same way
- **Free disk space.** The journald logs and the old versions in `/opt/notes/releases` grow if left alone, and deleting them is up to you
- **The gap between the code and the real machine.** What you fixed by hand in a session is recorded nowhere, and the next machine you build will not have that fix. The drift check looks at the settings of AWS resources and does not look inside the operating system
- **Backups.** Taking them is not enough. Confirm that you can restore from them
