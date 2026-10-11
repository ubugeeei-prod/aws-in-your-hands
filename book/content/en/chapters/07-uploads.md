---
title: "07 Upload Images: Presigned URLs and S3"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 07 Upload Images: Presigned URLs and S3

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/07-uploads` does not exist yet.

## Outcome

The browser sends an image straight to S3 with a presigned URL and attaches it to a note.

## Prerequisites

- [06 Add Login: Cognito and Authorization](/en/chapters/06-auth.md)

Reading paths: `shortest`

## Planned architecture

SPA → API (presign) → SPA → S3 PUT. Reads go through CloudFront + OAC.

Services: S3

## Topics

- What a presigned URL delegates and for how long
- Where content type and size can actually be enforced
- Object key design and per-user separation
- Lifecycle rules for incomplete uploads and orphaned objects
- CORS

## The distributed-systems angle

The S3 write and the DynamoDB update are not one transaction; the design tolerates orphans and cleans them up.

## Source required for completion

- Presign handler and input schema
- Bucket CDK (Block Public Access, lifecycle) with assertions
- A test reproducing an orphaned object when the note update fails after upload

## Primary sources to start from

None selected yet. Research primary sources when writing and add them to the registry.
