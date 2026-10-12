---
title: "23 VM: Deploy"
---

# 23 VM: Deploy

## Deploying, and getting in

<!-- section: 23.deploy -->

There is an order: the chapter 11 VPC first, then this chapter's stack. This follows the default layout.

```bash
vp run ec2:plan
vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages
vp run ec2:infra:diff
vp run ec2:infra:deploy
```

Hourly charges begin with the second line. To try the cheaper way, drop `-c` from the second line and add `-c placement=public` to the fourth. In that case, add the same `-c` to every later `ec2:infra:` command as well. Deploy without it and the instance is created again in the private subnet.

When the deploy finishes, user data is still running. Wait a few minutes, then look.

```bash
vp run ec2:status
```

It prints the instance's state as Systems Manager sees it (`Online` means the path and the permissions work), the cloud-init result, the state of the service, and the mount of the data volume. At this point the service is enabled but not running, because there is no application yet.

### Installing the application

```bash
vp run ec2:app:release
```

This task builds the API, puts it in S3, and tells the instance to come and get it. The telling is done with Run Command, which uses the same path as Session Manager to send a command and receive its result.

A release gets a name.

<<< @/examples/23-ec2/src/release.ts{version}

It is the build time and the first 16 digits of the content's hash. On the instance, a script that user data left behind receives it.

<<< @/examples/23-ec2/deploy/notes-release.sh

The arguments come from outside, so their shape is checked first. If they do not match, the script ends without doing anything. Next it compares the hash of the file fetched from S3 with the hash in the name, so that a truncated file or a different file is never started. Then it repoints a link called `current` at the new version, restarts the service, and waits for `/health` to answer. If there is no answer, it ends in failure, and so does the task.

Old versions stay on the instance, so going back is only a matter of repointing the link.

```bash
vp run ec2:app:rollback 20261012T010203Z-0123456789abcdef
```

Use a version name that `ec2:app:release` printed. Nothing rolls back automatically. Whether to go back is your decision.

Every command sent to the instance is built by this function.

<<< @/examples/23-ec2/src/remote.ts{commands}

### Checking that it works

```bash
vp run ec2:smoke
vp run ec2:logs
```

`ec2:smoke` runs `curl` on the instance, creates one note, and lists the notes. The API cannot be called from outside the instance, so it is called from inside.

To call it from `curl` or a browser on your machine, use port forwarding.

```bash
vp run ec2:forward
curl -s http://localhost:8787/health
```

While the first line is running, port 8787 on your machine is connected to port 8787 on the instance. Nothing was added to the security group. For an interactive shell there is `vp run ec2:session`.

These two need the Session Manager plugin in addition to the AWS CLI. The devShell does not include it, so install it by following the AWS documentation. Without it, you can still open a shell from Session Manager in the management console, and `ec2:status`, `ec2:smoke`, `ec2:logs`, and `ec2:app:release` work without the plugin.

Who may get in is decided by IAM, as said above. Turn that around: whoever is allowed `ssm:StartSession` or `ssm:SendCommand` is an administrator of this machine. Run Command runs its commands with administrative permissions, and the session user (`ssm-user`) can use `sudo`. Treat these two permissions with the weight of an SSH key.

The drift check is the same as in chapter 02.

```bash
vp run ec2:infra:drift
```

As the previous section said, none of these commands has been through a real instance. The thing to watch when they are is how cdkd handles the stack. Of its resource types, cdkd has its own implementation for the instance, security group, instance profile, role, and bucket. It has none for the volume and the volume attachment, which go through Cloud Control API. Reading the chapter 11 VPC outputs through `Fn::ImportValue` would also be run for the first time. These are the first things to verify.

## Snapshot and restore

<!-- section: 23.backup -->

There is one data volume. If it breaks, every note is gone. The safeguard is a snapshot: a copy of the volume at a point in time, kept in S3, and restorable as a volume in any zone of the Region. Snapshots are incremental, so from the second one on only what changed is stored.

The procedure in this section, too, was only checked as far as the flags of the commands, against the help of the AWS CLI in the devShell.

### Taking one

```bash
vp run ec2:data:unmount
aws ec2 create-snapshot --region ap-northeast-1 --volume-id vol-xxxxxxxxxxxxxxxxx --description "notes before the upgrade"
vp run ec2:data:mount
```

The volume ID is the stack output `DataVolumeId`.

Copying a volume that is being written to can capture a half-finished state. So the service is stopped and the volume unmounted first. A snapshot captures the contents at the moment it starts, and there is no need to wait for it to complete. Once its state is `pending`, the third line mounts the volume again and starts the service. The API is down in between.

What `ec2:data:mount` runs is the same script as on the first boot, with the same decision not to format.

### Going back

The most straightforward way is to let the stack create the volume from the snapshot.

```bash
vp run ec2:infra:deploy -c dataSnapshotId=snap-xxxxxxxxxxxxxxxxx
```

After the stack was destroyed, this creates the instance and a volume with the snapshot's contents. The first-boot script sees a file system and mounts it without formatting. Then `vp run ec2:app:release`, and the notes are back. The same goes for a zone that has become unusable: if the chapter 11 VPC has a subnet in another zone, you can restore there (this chapter's stack is fixed to the first zone, so that needs a code change).

Adding `dataSnapshotId` to a running stack is a different matter. In the CloudFormation documentation, a volume's `SnapshotId` is a property that cannot be updated. In the cdkd source it replaces the volume, and is refused unless `--force-stateful-recreation` is given, because the operation deletes the old volume. This path was only read, not run.

A volume created from a snapshot can be slow at first. Its contents are brought from S3 only when they are first read.

And last, the thing that is easiest to forget: a snapshot is not a resource of the stack. Destroy the stack and it stays, and keeps costing money. The cleanup section checks for it.

## Patching

<!-- section: 23.patch -->

With Lambda, patching the operating system was AWS's job. Here it is yours.

Amazon Linux 2023 has a property that surprises people who do not know it. An instance is **locked** to the package versions of the moment its AMI was built. Type `dnf upgrade` and nothing new arrives. Security updates are not applied on their own either. The same command gives the same result last month and this month, and that is the purpose.

In other words, if you do nothing, the machine grows old as it was on the day it started. There are two ways to patch.

**Upgrade in place.** Check whether a newer release exists, and upgrade to it by name.

```bash
vp run ec2:patch:check
vp run ec2:patch:apply 2023.12.20260930
```

The argument on the second line is a version that the first line printed. `latest` is not accepted. The Amazon Linux documentation says the same thing: asking for `latest` means trying an untested update in production first. If the kernel was updated, the old kernel keeps running until a reboot. Reboot with `aws ec2 reboot-instances`. The API is down while that happens.

**Replace.** Swap the instance for one from a newer AMI. All it takes is deploying with a new ID in `-c amiId=` from "Choosing an AMI". User data runs from the beginning, the data volume is attached again, and you install the release once more. No trace of manual changes remains, so the result is easier to predict. The Amazon Linux documentation recommends this way too.

There is something unknown here, though. How the volume attachment behaves during a replacement could not be worked out from the cdkd source: whether cdkd detaches it from the old instance and attaches it to the new one in that order, or fails midway. Until it has been tried on real AWS, this path is "should work". When you try it, take a snapshot first.

Systems Manager also has a feature called Patch Manager: find missing patches, apply them, list what is compliant. Once there are many machines, you will want it. One caution: according to the documentation, Patch Manager ignores the Amazon Linux 2023 version lock and always uses the latest repositories. This chapter does not configure it.

### The idea of staying replaceable

Take "replace" to its conclusion and you arrive at an Auto Scaling group. Give it a recipe for the instance (a launch template) and a count, and it replaces an instance that becomes unhealthy with a new one. With a count of one, "there is always one machine" becomes AWS's job.

This chapter does not build one. The reason is that if replacement happens automatically, everything a replacement requires must be automatic too: attaching the data volume again, and installing the release again. In the current layout both need a person. Whether automating that far is worth it is a decision to make together with the next section.

### What is yours on a long-lived machine

- **Patches for the operating system and the runtime.** Node.js is an operating system package too. It is upgraded the same way
- **Free disk space.** The journald logs and the old versions in `/opt/notes/releases` grow if left alone. Deleting them is up to you
- **The gap between the code and the real thing.** What you fixed by hand in a session is recorded nowhere. The next machine you build will not have that fix. The drift check looks at the settings of AWS resources, not inside the operating system
- **Backups.** Not just taking them: being able to restore them
