---
title: "24 Self-hosting: Costs, Pitfalls, and Cleanup"
---

# 24 Self-hosting: Costs, Pitfalls, and Cleanup

This page covers what to look at when the fleet does not work, what production would need on top of this setup, and how to clean up. It ends by looking at the chapter's design as a distributed system. The cost breakdown is on the [Design and Build](/en/chapters/24-celld/build.md) page.

## When it does not work

<!-- section: 24.failures -->

Run the tasks in roughly this order when you investigate.

```bash
vp run celld:status
vp run celld:logs a
vp run celld:diagnose
```

- **`celld:status` returns nothing.** The nodes cannot reach Systems Manager. Check the same things as in [chapter 23](/en/chapters/23-ec2/build.md), where Systems Manager replaced an open SSH port. Also check whether you redeployed the network stack without `-c` after adding the endpoints
- **The service stays `inactive`.** The unit skips its start without an error when the binary or the environment file is missing. Check whether you forgot `celld:install`
- **It starts and exits at once.** Read the log. AccessDenied on the bucket means the role's permissions are the cause. An error about being unable to write a file may mean that the unit's `ProtectSystem=strict` is blocking a location celld writes to (this combination has not been run). celld also stops at startup when an environment variable is invalid
- **`SELF-FENCE:` appears in the log.** The node could not renew its lease and stopped itself. systemd starts it again after 15 seconds. If it keeps happening, suspect the path to the bucket (the S3 gateway endpoint, the role)
- **`celld:diagnose` shows too few peers.** The lease of the missing node has expired, or its internal port cannot be reached. Look at the security group rule and the address in `CELLD_ADVERTISE`
- **`celld:rollout` stopped at settle.** The rollout has rolled nothing back. Read the log of the node it stopped at, and decide whether to get that node running or to reinstall the previous version with `celld:install <version> <node>`. The remaining nodes are still running the old version
- **Health keeps returning 503.** celld does not report a new node healthy until the fleet has settled. After 120 seconds it logs `ready_gate_expired` once, and the node stays closed after that

## If this were production

<!-- section: 24.production -->

The first decision is whether to use celld in production at all. Its authors call it a beta, and only the latest release gets security fixes. Before anything else, ask whether you have the people and the time to operate it. With that settled, this is what the chapter's setup lacks.

- **A way in.** celld does not terminate TLS and has no managed ingress. Put a proxy such as the ALB from chapter 12 in front, have the public listener listen on the private IP, and open that port to the proxy only. A new node starts receiving requests once it is among the load balancer's targets
- **Encryption of peer traffic.** See "Peer traffic has no TLS" on the [Design and Build](/en/chapters/24-celld/build.md) page
- **Capacity.** celld does not scale itself. The official documentation gives the signals for adding a node (`capacity_waiting`, `pressured`) and the conditions under which you may remove one. If you lose a node while the fleet is at its limit, that node's cells have nowhere to go
- **Monitoring.** Watch the number of `SELF-FENCE:` lines, health, `restoring`, and free disk space. The tools from chapter 19 can collect them, but this chapter does not wire them up
- **The size of the bucket.** By default the contents of the bucket grow every time a cell wakes up. The cleanup setting (`CELLD_LTX_RETENTION_SECS`) is off by default
- **The scope of credentials.** Permission to deploy the application is the fleet administrator's permission. If CI holds it, use OIDC from chapter 20 and limit it to this bucket's prefix
- **Keeping up with versions.** At every release, reread the upgrade notes, limitations, security, and guarantees. Nothing in this chapter lets you upgrade without reading them
- **AMI and OS patches.** The same as in chapter 23. If you rebuild nodes, do it one at a time, after a drain

With DynamoDB or SQS, AWS takes on this work. With celld, you take on all of it. celld can still be the right fit when you want to keep writing Durable Objects the way you already do, or when you want the state in your own bucket. I hope what you did in this chapter helps you decide.

## Cleaning up

<!-- section: 24.cleanup -->

Clean up in this order.

```bash
vp run celld:stop-all
vp run celld:infra:destroy
vp run net:infra:destroy
```

With the default `stateOnDestroy=retain`, the instances are deleted, and the two buckets and the data volumes remain. That is the intended behavior, but delete them once you have finished practicing.

```bash
aws ec2 describe-volumes --region ap-northeast-1 --filters Name=tag:Name,Values='AihCelld/*'
aws ec2 delete-volume --region ap-northeast-1 --volume-id <volume-id>
aws ec2 describe-snapshots --region ap-northeast-1 --owner-ids self --filters Name=tag-key,Values=aih:backup
aws s3 rm s3://<bucket>/ --recursive --dryrun
```

You can find the remaining volumes by their Name tag. Snapshots taken by `celld:backup` carry the `aih:backup` tag. To remove a bucket, empty it and then run `aws s3 rb`. While the stack still exists, `vp run celld:bucket-empty` and `vp run celld:bucket-empty backups` empty the buckets the same way (without `--yes` they only list the contents).

If you created the stack with `-c stateOnDestroy=delete` from the start, empty the buckets before the destroy, because the pinned version of cdkd does not delete a bucket that is not empty.

```bash
vp run celld:bucket-empty --yes
vp run celld:bucket-empty backups --yes
vp run celld:infra:destroy
```

The setting that applies at destroy time should be the one the stack was deployed with. Whether cdkd synthesizes the template again at that point has not been checked, though. If volumes or buckets remain after the destroy, delete them with the steps above.

If you forget `net:infra:destroy`, the endpoints keep costing USD 61.32 a month. To keep the VPC, run `vp run net:infra:deploy` without `-c`, which removes only the endpoints.

What remains on your machine is the archives and the binary in `examples/24-celld/.celld/`. They are not tracked by git.

## As a distributed system

<!-- section: 24.distributed -->

To finish, here is who guaranteed what in this chapter.

The state lives in three places. The bucket holds the long-lived state and the ownership records. The disk of the owning node is the second place. The third is the followers' disks, which hold acknowledged writes the bucket does not have yet. Do not reason that the data is safe because S3 is there. Ask which write is where at this moment.

The invariants are celld's own. A cell has one owner at a time, and an acknowledged write is not lost. celld's protocol is what keeps them, and the protocol relies on the bucket's conditional writes and on how the supervisor behaves. The CDK code and the scripts in this chapter have one job, which is not to break those assumptions. They wait longer than a lease lifetime before a restart, wait longer than 40 seconds on a stop, never stop two nodes at once, never discard every disk at once, and never mix versions that must not be mixed.

This chapter does not claim that no write is lost whatever the failure. celld documents its own limits. A follower that keeps returning errors can keep recovery from making progress. A final batch that disappears entirely can go undetected. Mixed versions can stall recovery. A fleet at its limit cannot take in the cells of a node it lost. What survives the loss of several nodes and disks at once depends on how far each write had got.

The tests in this chapter check something much earlier than that. They check that the function deciding the procedure runs it in the decided order and stops on a failure, and that the judge can tell a broken toy fleet from a sound one. Whether celld keeps its promises can only be checked by running `celld:loss-check` on real nodes, and that work is left to you.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (failures injected at each step of the function that orders an upgrade, the ledger judged against a toy fleet, the probe script run by bash and curl, the install script refusing bad arguments and a mismatched digest when run by bash, generation of the unit and user data, reading `celld diagnose --json` output, backup and restore plans, pricing inputs, stack assertions). Type checking. `celld:infra:synth` (default, `-c nodes=1`, `-c nodes=3`, `-c nodes=2 -c stateOnDestroy=delete`, `-c nodes=2 -c dataSnapshots=a:snap-0123456789abcdef0`). `celld:plan`, `celld:render`. `celld:fetch` (downloaded the Linux arm64 archives of v0.6.2 and v0.6.1; size and SHA-256 matched the pinned values. `--host` was not used, and nothing was unpacked or run). Separately, all six archives of v0.6.2 and v0.6.1 for the three platforms were downloaded and matched the digests the GitHub API returns. That the devShell's AWS CLI (2.35.11) accepts `aws ec2 stop-instances --skip-os-shutdown` was confirmed from its help output.

**Not checked yet.** Nothing was run against AWS: not `celld:infra:diff`, `celld:infra:deploy`, `celld:infra:drift`, or `celld:infra:destroy`, and none of the tasks that touch a node, from `celld:status` to `celld:bucket-empty`. The celld binary was never run either (`celld dev`, `celld deploy`, starting a node, `celld diagnose`). So the following was only read. That celld obtains credentials from the instance role (IMDSv2 required, hop limit 1). That the S3 gateway endpoint alone reaches the fleet bucket. That this chapter's list of IAM actions is enough. That celld runs under systemd's `ProtectSystem=strict`. That a `t4g.small` is enough. The real output of `celld diagnose --json` (the samples in the tests are assembled from the format strings in `fleet.rs` at v0.6.2; they are not copies of real output). How the handoff on SIGTERM and the health gate really behave. That the remaining nodes take over cells after `--skip-os-shutdown`. That a fleet restored from a backup starts. That cdkd can carry out the restore deploy that replaces volumes. The way `-c` and `--yes` are passed to `vp run` tasks follows the form used up to chapter 23.

What primary sources could not settle. The list of S3 actions celld needs (it is a translation of the Azure wording). celld together with bucket versioning. Whether `CELLD_NODE` may be fixed across restarts. Whether a copy of a live fleet's bucket can be restored from. celld's minimum memory requirement. The systemd version on Amazon Linux 2023 (the v252 man pages were read; no instance was checked). Cloudflare's own guarantees and prices for Durable Objects were not looked into.

What changed from the requested design. "Peer traffic over a private network and TLS" became "a private network only", because celld has no TLS. The check after losing a node does not read ownership records directly; it judges the counter history a client can see (the record format is not a published interface).

The S3 unit prices were not reread for this chapter. It uses the prices that chapters 07, 11, and 23 recorded from the AWS Price List (checked 2026-10-11 and 2026-10-12) as they are.

Resource types as cdkd handles them. I read the `dist` of the pinned npm package (0.296.28). `AWS::EC2::Instance`, `AWS::EC2::SecurityGroup`, and `AWS::EC2::SecurityGroupIngress` are registered with the EC2 provider; `AWS::IAM::InstanceProfile`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::S3::Bucket`, and `AWS::S3::BucketPolicy` each with a provider of their own. `AWS::EC2::Volume` and `AWS::EC2::VolumeAttachment` are not registered and go through Cloud Control API (the same finding as chapter 23). `AWS::EC2::SecurityGroupEgress` is not registered either, so the outbound rules are written inside the security group instead of as separate resources. cdkd's documentation describes cdkd as for development and test use and recommends the AWS CDK CLI for production (this rests on a source recorded by earlier chapters; it was not reread for this one).

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Pin the version, and check what you got | `examples/24-celld/src/celld.ts`, `scripts/fetch.ts` | `celld:fetch`, `test:unit` |
| The big picture | `examples/24-celld/infra/lib/celld-stack.ts`, `infra/bin/app.ts`, `src/config.ts`, `src/report.ts`, `scripts/plan.ts` | `celld:plan`, `celld:infra:synth` |
| Peer traffic has no TLS | `examples/24-celld/infra/lib/celld-stack.ts`, `infra/test/celld-stack.test.ts` | `celld:infra:synth`, `test:unit` |
| State lives in the bucket, and you still cannot throw the disks away | `examples/24-celld/infra/lib/celld-stack.ts`, `infra/test/celld-stack.test.ts` | `celld:infra:synth`, `test:unit` |
| Inside a node | `examples/24-celld/src/machine.ts`, `deploy/`, `scripts/render.ts`, `test/machine.test.ts` | `celld:render`, `test:unit` |
| Cost | `examples/24-celld/src/cost.ts`, `test/pricing.test.ts`, `data/pricing/` | `celld:plan`, `test:unit` |
| What you can check locally, and what you cannot | `examples/24-celld/test/`, `infra/test/` | `test:unit`, `celld:plan`, `celld:render`, `celld:infra:synth`, `celld:fetch` |
| One node first | `examples/24-celld/scripts/fleet.ts`, `src/remote.ts`, `test/remote.test.ts` | `celld:infra:deploy`, `celld:artifacts`, `celld:install`, `celld:app-deploy`, `celld:start`, `celld:status`, `celld:smoke`, `celld:diagnose` |
| Make it a fleet, and replace nodes one at a time | `examples/24-celld/src/rollout.ts`, `src/health.ts`, `test/rollout.test.ts`, `test/health.test.ts` | `celld:drain`, `celld:rollout`, `celld:stop-all`, `test:unit` |
| Losing a node | `examples/24-celld/src/probe.ts`, `src/ledger.ts`, `test/toy-fleet.ts`, `test/ledger.test.ts`, `test/probe.test.ts` | `celld:loss-check`, `celld:kill`, `celld:revive`, `test:unit` |
| Backup and restore | `examples/24-celld/src/backup.ts`, `test/remote.test.ts` | `celld:backup`, `celld:restore`, `test:unit` |
| When it does not work | `examples/24-celld/scripts/fleet.ts` | `celld:status`, `celld:logs`, `celld:diagnose` |
| Cleaning up | `examples/24-celld/scripts/fleet.ts` | `celld:infra:destroy`, `celld:bucket-empty` |
| As a distributed system | `examples/24-celld/src/ledger.ts`, `test/ledger.test.ts` | `test:unit` |

**Primary sources** (all checked 2026-10-12)

- celld v0.6.2 (the tag's commit is `90b43017241f`): [README](https://github.com/denoland/celld/blob/v0.6.2/README.md), [documentation](https://github.com/denoland/celld/blob/v0.6.2/docs/README.md) (Shut down and roll out a node, Upgrade notes, Environment variables), [What celld guarantees](https://github.com/denoland/celld/blob/v0.6.2/docs/guarantees.md), [Security](https://github.com/denoland/celld/blob/main/docs/security.md), [Limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md), [Testing](https://github.com/denoland/celld/blob/v0.6.2/docs/testing.md), [source](https://github.com/denoland/celld/tree/v0.6.2/crates/celld) (`main/cli.rs`, `fleet.rs`, `main.rs`, `bucket.rs`, `protocol.rs`), [counter example](https://github.com/denoland/celld/tree/v0.6.2/examples/counter), [releases](https://api.github.com/repos/denoland/celld/releases), [installer](https://celld.dev/install.sh) (read, not run). The default branch of the [repository](https://github.com/denoland/celld) was at the same commit as the v0.6.2 tag when checked. [celld.dev/docs](https://celld.dev/docs/) and [celld.dev/docs/guarantees](https://celld.dev/docs/guarantees/) were read through a summary; the chapter's claims rest on the repository files
- EC2: [StopInstances](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_StopInstances.html), [Data protection](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/data-protection.html), [Instance metadata categories](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html), [Access instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html)
- S3: [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html), [Multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html). AWS CLI: [s3 sync](https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html)
- Sources of the systemd v252 man pages: [systemd.service](https://github.com/systemd/systemd/blob/v252/man/systemd.service.xml), [systemd.unit](https://github.com/systemd/systemd/blob/v252/man/systemd.unit.xml), [systemd.kill](https://github.com/systemd/systemd/blob/v252/man/systemd.kill.xml)
- cdkd: the `dist` of [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28), read from the installed package
- The sources recorded by chapters 23 and 11 (Systems Manager, EBS snapshots, CloudFormation `DeletionPolicy`, AWS Price List) are in those chapters' verification notes. They were not reread for this chapter

:::
