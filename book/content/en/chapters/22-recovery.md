---
title: "22 Recover Data and Service: PITR, Snapshots, S3 Versioning, and AWS Backup"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 22 Recover Data and Service: PITR, Snapshots, S3 Versioning, and AWS Backup

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/22-recovery` does not exist yet.

## Outcome

You actually restore accidentally deleted notes and images and record the time taken and data lost.

## Prerequisites

- [05 Persist Notes: DynamoDB](/en/chapters/05-dynamodb.md)
- [07 Upload Images: Presigned URLs and S3](/en/chapters/07-uploads.md)

Reading paths: `sql`, `cloudflare-d1`

## Planned architecture

DynamoDB PITR → restore into a new table → cut over. S3 restores from versions.

Services: DynamoDB PITR, S3 Versioning, S3 Replication, AWS Backup

## Topics

- Replication is not backup: deletions replicate too
- Measuring RPO and RTO
- Restores create new resources: the effect on IaC and drift
- Backup storage cost

## The distributed-systems angle

The database and the object store restore to different points in time; detect and repair the mismatch.

## Source required for completion

- Backup and restore vp tasks (cache: false)
- A script checking the chapter 05 and 08 invariants after restore
- A drill record template

## Primary sources to start from

None selected yet. Research primary sources when writing and add them to the registry.
