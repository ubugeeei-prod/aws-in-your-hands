---
title: "23 VM: Costs, Pitfalls, and Cleanup"
---

# 23 VM: Costs, Pitfalls, and Cleanup

## One machine is a single point of failure

<!-- section: 23.spof -->

In this chapter's layout, state lives in one place: one file, on one volume, in one zone. One process reads and writes it.

What stops when something happens, and what comes back? Side by side:

```text
event                              API stops for        comes back by itself?                      the notes
process crashes                    about 2 s            yes: systemd, Restart=on-failure           kept
release, or a restart              a few seconds        yes: part of the same command              kept
OS hangs, kernel panics            until you act        no: the instance status check fails        kept
host hardware fails                minutes (unmeasured) usually: automatic recovery, same instance kept; memory is lost
instance terminated or replaced    until you redeploy   no: deploy again, then release again       kept: the volume is its own resource
data volume lost or damaged        until you restore    no: restore from a snapshot                back to the last snapshot
zone ap-northeast-1a impaired      as long as it lasts  no: this stack has nothing in another zone unreachable until the zone is back
```

The first two rows are handled by what this chapter built.

The fourth row is handled by EC2. Every minute EC2 runs status checks, and when something is wrong with the infrastructure on AWS's side (power, network, the physical host), automatic recovery moves the instance to other hardware. It is on from the start for instances that support it. The instance ID, the IP addresses, the attached volumes, and the zone all stay the same. Only what was in memory is lost. For the notes API, that is the same as a reboot.

Do not lean on it too much, though. Recovery acts only when the infrastructure check fails. When the operating system itself is stuck, as in the third row, the other check (the instance status check) fails, and nothing is done about it. Fixing it is up to you. And recovery does not act when the hardware to move to has no capacity, or while the AWS Health Dashboard lists a service event. In a large outage, which is exactly when you want the help, you cannot count on it.

From the fifth row on, a person has to act. If it is the middle of the night, things stay down until morning.

### Conditions for accepting one machine

So this is not saying "one machine is wrong". For many uses, one is enough. But if you accept it, put the conditions into words.

1. **The time it may be down is longer than the time it takes a person to notice and fix it.** It will be down for minutes to hours, nights and holidays included
2. **Going back to the last snapshot is acceptable.** Or the data can be rebuilt from somewhere else
3. **Somebody notices that it stopped.** Without a way of noticing, the time in condition 1 is unbounded
4. **The rebuild procedure has been run at least once.** A first restore on the day of the failure is something to avoid

If you can say yes to all four, one machine is the right choice. It is cheap, simple, and you can see everything that is going on.

If you cannot, you need a second machine, in another zone. And here you notice something: this chapter's layout cannot simply become two machines, because the notes are in a file on one of them. To have two, state has to move off the machine (DynamoDB from chapter 05, or the database from chapter 13), with a load balancer in front. Go that far and much of the reason for owning the machine is gone. Fargate in chapter 12 does the same with far less work.

One EC2 instance is for when you want state on the machine and one machine's worth of reliability is enough. celld in chapter 24 is the step after that: several machines, with state still on them.

### What the tests pin down

The invariant of this section is the same sentence as before: a note that was answered with 201 can be read after the process restarts and after the instance is replaced. Rows 1, 2, and 5 of the table are that. `test/file-notes.test.ts` attacks it with stops in the middle of a write, and `test/data-volume.test.ts` with a replaced instance.

What cannot be kept is in a test as well. `test/access.test.ts` takes down the instance's zone in the chapter 11 route model and sees that the instance reaches nothing. "The API answers while one zone is down" does not hold in this layout. It is a test that says of something that does not hold that it does not hold.

Every one of these tests breaks a model or a stand-in disk. No real instance was taken down.

## Lambda, Fargate, EC2

<!-- section: 23.compare -->

The same API can now live in three places (Fargate is [chapter 12](/en/chapters/12-containers.md)). Side by side:

| | Lambda (chapter 04) | Fargate (chapter 12) | EC2 (this chapter) |
| --- | --- | --- | --- |
| What runs | An execution environment, only when called | A container kept running | A machine kept running |
| Length of one piece of work | 15 minutes at most | No fixed limit | No fixed limit |
| Cost when nobody calls | 0 | Billed | Billed. Volumes are billed even when stopped |
| The kernel | Not yours to touch | Not yours to touch | Yours |
| Local disk | `/tmp`, temporary, per execution environment | Temporary, per task (20 GiB by default) | An EBS volume that can outlive the instance |
| OS patches | AWS | The host is AWS's. What is in the image is yours | All yours |
| When it dies | A new environment at the next call | The service replaces the task | systemd restarts the process. Beyond that, you |

A good way to choose is to go from the top. If Lambda will do, use Lambda. If the work does not fit in 15 minutes or connections have to stay open, Fargate. EC2 is for what is still missing after that: the kernel, the hardware, a disk on the machine.

The further down, the more you can do and the more you have to do. EC2 really is the freest of the three, but that does not mean the most capable. It means the widest range of things you do yourself.

"Billed" in the Fargate column carries no amount because the unit prices were not checked in this chapter. The amounts are under "What it costs" in [chapter 12](/en/chapters/12-containers.md).

## Where people get stuck

| When this happens | Look here |
| --- | --- |
| `ec2:infra:deploy` fails to resolve an import | Is the chapter 11 stack (`AihNetwork`) deployed? |
| `ec2:status` says the instance is not registered with Systems Manager | There is no path. Give `vp run ec2:plan` the settings chapter 11 was deployed with and look for `UNREACHABLE`. In the first few minutes after launch, registration may simply not be finished |
| It is `Online`, but there is no service and no `/opt/notes` | User data failed partway. Look at the cloud-init line of `ec2:status`, then connect with `ec2:session` and read `/var/log/cloud-init-output.log`. If it stopped at `dnf`, the package repositories were not reachable |
| `ec2:app:release` ends with `AccessDenied` | The instance's role may read only under `releases/` in the release bucket |
| After a release, it says `/health` did not answer | `vp run ec2:logs`. `Invalid environment` points at the settings file, `refusing to start over it` at a damaged notes file |
| The service stays `failed` | It died five times in a minute and systemd gave up. Fix the cause, then release again |
| The service refuses to start and the log talks about a mount | The data volume is not mounted. `vp run ec2:data:mount` |
| `ec2:session` says the plugin is missing | The Session Manager plugin is installed separately from the AWS CLI |
| A deploy replaced the instance | The "latest" AMI changed, or you passed a different `-c` than last time. Read the `diff` first. The AMI can be pinned with `-c amiId=` |
| `ec2:infra:destroy` stops while detaching the volume | Run `vp run ec2:data:unmount` first. A mounted volume does not detach cleanly |
| You stopped the instance and are still billed | The volumes, and the interface endpoints of chapter 11, are billed while it is stopped |

The symptoms in this table were put together from the documentation and the source. They were not reproduced.

## If this were production

- **Decide whether one machine is acceptable.** Answer the four conditions above. If any answer is no, this chapter's layout is not the one
- **Do not delete the data with the stack.** `-c dataOnDestroy=snapshot` or `retain`. Take snapshots on a schedule, and run a restore once
- **Pin the AMI and have a patch schedule.** With "latest", AWS's releases decide the day of the replacement
- **Send logs and metrics off the machine and add alarms.** So that the reason does not vanish along with the machine (for how to put an alarm together, see [chapter 19](/en/chapters/19-observability.md))
- **Narrow down who may get in.** Who holds `ssm:StartSession` and `ssm:SendCommand`? Sessions can be recorded as well
- **To publish the API, put a load balancer in front.** Do not open a port on the instance directly ([chapter 12](/en/chapters/12-containers.md))
- **Review the instance's role.** `AmazonSSMManagedInstanceCore` can read widely in Parameter Store. Check what is kept there
- **Turn on termination protection.** An instance has a setting that refuses termination through the API
- **Deploy with the AWS CDK CLI and CloudFormation.** The official cdkd documentation describes cdkd as for development and testing and recommends the AWS CDK CLI for production (chapter 02)
- **Set up a spending alert.** The budget from chapter 01 is the last net for an instance you forgot to delete. It is a notification, not a cap

## Cleaning up

<!-- section: 23.cleanup -->

There is an order.

```bash
vp run ec2:data:unmount
vp run ec2:releases:empty --yes
vp run ec2:infra:destroy
vp run net:infra:destroy
```

The first line puts the data volume into a state in which it can be detached. The second empties the release bucket: the pinned cdkd does not delete a bucket that is not empty (without `--yes` it only lists). The third deletes the instance, the volume, the bucket, and the role. The notes go too. The fourth deletes the VPC and the interface endpoints. To keep the VPC, run `vp run net:infra:deploy` without `-c` and only the endpoints are removed.

Stop after the third line and the endpoint charges (USD 61.32 a month) continue. The most expensive part of this chapter is outside this chapter's stack.

Check with your own eyes that things are gone.

```bash
aws ec2 describe-instances --region ap-northeast-1 --filters Name=instance-state-name,Values=pending,running,stopping,stopped
aws ec2 describe-volumes --region ap-northeast-1
aws ec2 describe-snapshots --region ap-northeast-1 --owner-ids self
aws ec2 describe-vpc-endpoints --region ap-northeast-1
```

If the first and second are empty and the fourth has no endpoint of the Interface type, the hourly charges have stopped. A snapshot in the third is one you took yourself or one that `dataOnDestroy=snapshot` left. If you do not need it, delete it with `aws ec2 delete-snapshot`. With `dataOnDestroy=retain`, a volume remains in the second.

What is left is only the storage that the cdkd bootstrap created (chapter 02).

::: details Verification notes for this chapter

**Checked locally.** Unit tests (the file-backed repository stopped at each step of a write, SIGTERM over a real socket, generation of the unit and user data with injection refused, the data volume script run by bash, Run Command arguments, the route model, pricing inputs, and stack assertions). Type checking. `ec2:infra:synth` (the default, `-c placement=public`, `-c dataOnDestroy=snapshot`, `-c dataSnapshotId=snap-0123456789abcdef0`, and `-c amiId=ami-0123456789abcdef0`). `ec2:plan` (the default, `placement=public`, a network without the endpoints, and invalid settings). `ec2:render`. `ec2:app:build`. The built `dist/server.mjs` and `src/server.ts` were started on Node.js 24 to check create, list, that notes remain after a restart, that SIGTERM ends with exit code 0, and that a damaged file prevents the start. The amounts in the text are computed by `tools/src/pricing/calc.ts` from Price List unit prices, and `examples/23-ec2/test/pricing.test.ts` compares them. The AWS CLI flags that appear in the text were checked against the help of AWS CLI 2.35.11 in the devShell.

**Not checked yet.** Nothing was run against AWS: none of `ec2:infra:diff`, `ec2:infra:deploy`, `ec2:infra:drift`, `ec2:infra:destroy`, `ec2:status`, `ec2:session`, `ec2:forward`, `ec2:app:release`, `ec2:app:rollback`, `ec2:smoke`, `ec2:logs`, `ec2:data:unmount`, `ec2:data:mount`, `ec2:patch:check`, `ec2:patch:apply`, or `ec2:releases:empty`. All of the following therefore await a real instance. That cdkd 0.296.28 creates and deletes this stack. That the AMI ID resolves from the SSM-typed parameter. That user data runs to the end on Amazon Linux 2023 (that the package repositories are reachable from a private subnet through the S3 gateway endpoint alone, that `nodejs24` and `xfsprogs` install, that the `/dev/sdf` link appears, that the unit's directives are accepted). The size of the root volume (pricing assumes 8 GiB). Whether all three interface endpoints are needed. Session Manager and port forwarding (the plugin is not in the devShell). Release and rollback, and that a restart lets a request in flight finish. The snapshot and restore procedure. That the data volume is attached again when the instance is replaced. Both ways of patching. How automatic recovery behaves, and the times in the table under "One machine is a single point of failure". The symptoms under "Where people get stuck".

Not confirmed from primary sources. No page was found that says the Amazon Linux 2023 repositories can be reached through the S3 gateway endpoint alone. Whether the `ec2messages` interface endpoint may be left out is written only in terms of permissions. The size and device name of the root volume of the Amazon Linux 2023 AMI were not confirmed, which is why the root volume's settings are left untouched (its encryption, too, follows the account's default). To which accounts, and for how long, the Free Tier allowances for EC2 and EBS apply could not be confirmed. The systemd directives were read in the v252 man pages, but the version that Amazon Linux 2023 ships was not looked at. Whether Cloudflare has an experience that corresponds to a virtual machine was not investigated, so there is no comparison. Fargate unit prices were not looked up either.

Resource types that cdkd handles. In `src/provisioning/register-providers.ts` at the `v0.296.28` tag, `AWS::EC2::Instance` and `AWS::EC2::SecurityGroup` are registered with the EC2 provider, and `AWS::IAM::InstanceProfile`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::S3::Bucket`, and `AWS::S3::BucketPolicy` each with their own implementation. `AWS::EC2::Volume`, `AWS::EC2::VolumeAttachment`, and `AWS::EC2::LaunchTemplate` are not registered and go through Cloud Control API (deleting a volume is the exception: cdkd calls EC2 `DeleteVolume` directly). This chapter uses no launch template. Passing `requireImdsv2` to CDK's `Instance` creates one, whereas `metadataOptions` on `CfnInstance` stays within the instance's own properties, which cdkd's implementation writes. A resource whose template uses a property that the implementation does not write is routed to Cloud Control API, so a test pins the list of properties. The source also showed that a change to `UserData` is not applied to the instance, that a change to `ImageId`, `SubnetId`, or `NetworkInterfaces` replaces it, and that an SSM-typed parameter is resolved with `GetParameter` at deploy time only when something references it.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| What it costs just to exist | `examples/23-ec2/src/cost.ts`, `src/report.ts`, `scripts/plan.ts`, `test/pricing.test.ts`, `data/pricing/` | `ec2:plan`, `test:unit` |
| The big picture | `examples/23-ec2/infra/lib/ec2-stack.ts`, `infra/bin/app.ts`, `src/config.ts` | `ec2:infra:synth` |
| No SSH port | `examples/23-ec2/infra/lib/ec2-stack.ts`, `src/access.ts`, `test/access.test.ts`, `examples/11-network/infra/lib/import-network.ts` | `ec2:plan`, `test:unit` |
| The instance fetches its permissions from inside | `examples/23-ec2/infra/lib/ec2-stack.ts`, `infra/test/ec2-stack.test.ts` | `test:unit`, `ec2:infra:synth` |
| Choosing an AMI | `examples/23-ec2/infra/lib/ec2-stack.ts`, `infra/test/ec2-stack.test.ts` | `test:unit`, `ec2:infra:synth` |
| What the first boot does | `examples/23-ec2/src/machine.ts`, `src/user-data.ts`, `src/rendered.ts`, `scripts/render.ts`, `deploy/user-data.sh`, `test/machine.test.ts` | `ec2:render`, `test:unit` |
| Turning a process into a service | `examples/23-ec2/src/unit.ts`, `deploy/notes.service`, `deploy/notes.env`, `test/machine.test.ts` | `ec2:render`, `test:unit`, `ec2:logs` |
| Stopping politely | `examples/23-ec2/src/shutdown.ts`, `src/server.ts`, `test/shutdown.test.ts` | `test:unit`, `dev:ec2` |
| Data goes on a separate volume | `examples/23-ec2/src/file-notes.ts`, `src/node-files.ts`, `deploy/notes-data-volume.sh`, `test/file-notes.test.ts`, `test/data-volume.test.ts` | `test:unit` |
| Checking it on your machine | `examples/23-ec2/src/server.ts`, `src/env.ts`, `.env.example`, `scripts/build.ts` | `dev:ec2`, `test:unit`, `ec2:plan`, `ec2:render`, `ec2:app:build`, `ec2:infra:synth` |
| Deploying, and getting in | `examples/23-ec2/scripts/remote.ts`, `src/remote.ts`, `src/release.ts`, `deploy/notes-release.sh`, `test/remote.test.ts`, `tools/src/infra/` | `ec2:infra:diff`, `ec2:infra:deploy`, `ec2:status`, `ec2:app:release`, `ec2:app:rollback`, `ec2:smoke`, `ec2:logs`, `ec2:forward`, `ec2:session`, `ec2:infra:drift` |
| Snapshot and restore | `examples/23-ec2/scripts/remote.ts`, `src/remote.ts`, `deploy/notes-data-volume.sh` | `ec2:data:unmount`, `ec2:data:mount` |
| Patching | `examples/23-ec2/scripts/remote.ts`, `src/remote.ts`, `test/remote.test.ts` | `ec2:patch:check`, `ec2:patch:apply` |
| One machine is a single point of failure | `examples/23-ec2/test/access.test.ts`, `test/file-notes.test.ts`, `test/data-volume.test.ts` | `test:unit` |
| Cleaning up | `examples/23-ec2/scripts/remote.ts`, `tools/src/infra/` | `ec2:data:unmount`, `ec2:releases:empty`, `ec2:infra:destroy`, `net:infra:destroy` |

**Primary sources** (all checked on 2026-10-12)

- Systems Manager: [VPC endpoints for Systems Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html), [ec2messages, ssmmessages, and other API operations](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-setting-up-messageAPIs.html), [AMIs with the SSM Agent preinstalled](https://docs.aws.amazon.com/systems-manager/latest/userguide/ami-preinstalled-agent.html), [Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html), [Session Manager prerequisites](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-prerequisites.html), [Start a session](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html), [Install the Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html), [Instance permissions](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-instance-permissions.html), [AmazonSSMManagedInstanceCore](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonSSMManagedInstanceCore.html), [Run Command walkthrough](https://docs.aws.amazon.com/systems-manager/latest/userguide/walkthrough-cli.html), [GetCommandInvocation](https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetCommandInvocation.html), [Patch Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager.html), [Patch Manager prerequisites](https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager-prerequisites.html), [Patch baseline rules on Linux](https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager-linux-rules.html), [Systems Manager pricing](https://aws.amazon.com/systems-manager/pricing/)
- EC2: [Instance metadata service](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html), [Instance metadata options](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html), [IAM roles for Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html), [User data](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html), [Instance state changes](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html), [Stop and start](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html), [Instance IP addressing](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-instance-addressing.html), [Automatic instance recovery](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-recover.html), [Simplified automatic recovery](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-configuration-recovery.html), [Status checks](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-system-instance-status-check.html), [Unlimited mode for burstable instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode-concepts.html), [Preserve data when an instance is terminated](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/preserving-volumes-on-termination.html), [Auto Scaling health checks](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-health-checks.html), [Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)
- Amazon Linux 2023: [AL2023 on Amazon EC2](https://docs.aws.amazon.com/linux/al2023/ug/ec2.html), [IMDSv2](https://docs.aws.amazon.com/linux/al2023/ug/imdsv2.html), [Deterministic upgrades](https://docs.aws.amazon.com/linux/al2023/ug/deterministic-upgrades.html), [Updating AL2023](https://docs.aws.amazon.com/linux/al2023/ug/updating.html), [Updates via instance replacement](https://docs.aws.amazon.com/linux/al2023/ug/security-instance-replacement.html), [Manage package and operating system updates](https://docs.aws.amazon.com/linux/al2023/ug/managing-repos-os-updates.html), [Node.js](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html), [AWS CLI v2](https://docs.aws.amazon.com/linux/al2023/ug/awscli2.html), [systemd journal](https://docs.aws.amazon.com/linux/al2023/ug/journald.html), [gp3 and XFS](https://docs.aws.amazon.com/linux/al2023/ug/continuing-al2-filesystem.html)
- EBS: [EBS volumes](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html), [NVMe device names](https://docs.aws.amazon.com/ebs/latest/userguide/identify-nvme-ebs-device.html), [Make a volume available for use](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-using-volumes.html), [EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html), [Create snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-creating-snapshot.html), [Replace a volume using a snapshot](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-restoring-volume.html), [Initialize volumes](https://docs.aws.amazon.com/ebs/latest/userguide/initalize-volume.html)
- CloudFormation: [AWS::EC2::Instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html), [AWS::EC2::Volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html), [AWS::EC2::VolumeAttachment](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volumeattachment.html), [AWS::IAM::InstanceProfile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html), [CloudFormation-supplied parameter types](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cloudformation-supplied-parameter-types.html), [DeletionPolicy](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-deletionpolicy.html)
- AWS Price List bulk API: [EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.json) (instances, EBS, CPU credits; about 446 MB). The unit prices of public IPv4 addresses and interface endpoints are the ones chapter 11 read from [VPC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-northeast-1/index.json); they were not read again for this chapter
- Comparison: [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html), [Lambda ephemeral storage](https://docs.aws.amazon.com/lambda/latest/dg/configuration-ephemeral-storage.html), [AWS Fargate for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html), [Fargate task ephemeral storage](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html), [Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html), [CloudWatch agent configuration file](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Agent-Configuration-File-Details.html)
- Sources of the systemd v252 man pages: [systemd.service](https://github.com/systemd/systemd/blob/v252/man/systemd.service.xml), [systemd.unit](https://github.com/systemd/systemd/blob/v252/man/systemd.unit.xml), [systemd.exec](https://github.com/systemd/systemd/blob/v252/man/systemd.exec.xml), [systemd.kill](https://github.com/systemd/systemd/blob/v252/man/systemd.kill.xml). [Node.js v24: HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html)
- cdkd v0.296.28: [src](https://github.com/go-to-k/cdkd/tree/v0.296.28/src), [destroy](https://github.com/go-to-k/cdkd/blob/v0.296.28/docs/cli-destroy.md), [Introduction](https://cdkd.dev/introduction/). [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (type definitions and the JavaScript in the package)

:::
