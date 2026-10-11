---
title: "24 Advanced Lab: Self-Hosting celld on AWS"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 24 Advanced Lab: Self-Hosting celld on AWS

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/24-celld` does not exist yet.

## Outcome

You run celld on one EC2 instance, then try draining, upgrading, and recovery on a small fleet.

## Prerequisites

- [22 Recover Data and Service: PITR, Snapshots, S3 Versioning, and AWS Backup](/en/chapters/22-recovery.md)
- [23 EC2 When You Want Control: SSM, EBS, and Process Management](/en/chapters/23-ec2.md)


## Planned architecture

Nodes in private subnets (private peer traffic over TLS) with retained EBS volumes and an S3 bucket. CDK stops at infrastructure; deploying celld is a separate procedure.

Services: EC2, EBS, S3, VPC

## Topics

- celld is self-operated, version-pinned OSS (beta when researched), not an AWS managed service
- Rechecking the official limitations, security, guarantees, and upgrade notes
- S3 does not mean every node disk can be discarded at once
- Drain and upgrade ordering
- No invented cdkd integration

## The distributed-systems angle

Guarantees depend on celld's documented protocol and failure model; no claim of losslessness under arbitrary failures.

## Source required for completion

- Fleet CDK with retention assertions
- Scripts and vp tasks for deploy, drain, upgrade, and backup/restore
- A check of the object-ownership invariant after losing a node

## Primary sources to start from

- [celld source](https://github.com/denoland/celld) (not re-read while writing)
- [celld limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md) (not re-read while writing)
- [celld security](https://github.com/denoland/celld/blob/main/docs/security.md) (not re-read while writing)
- [celld guarantees](https://celld.dev/docs/guarantees/) (not re-read while writing)
- [celld documentation](https://celld.dev/docs/) (not re-read while writing)
