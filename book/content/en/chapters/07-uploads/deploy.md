---
title: "07 File Upload: Deploy"
---

# 07 File Upload: Deploy

## Getting ready for AWS

<!-- section: 07.infra -->

The stack (`AihUploads`) is chapter 06's stack with one more bucket, two more permission statements, and four more routes.

### The bucket

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{uploads-bucket}

All four Block Public Access settings are on. Neither an ACL nor a bucket policy can make an object in this bucket public. A presigned URL is not "public": it is a request signed by the role, so it works under these settings.

CORS allows two origins (the deployed SPA and the local development server) and the method `POST` only. The browser's JavaScript needs it to read the result of a POST to another origin. Showing an image with `<img>` needs no CORS rule, so `GET` is not listed.

There are two lifecycle rules. One is the cleanup of pending objects from before. The other aborts incomplete multipart uploads. A multipart upload sends a large object in parts, and the parts of an upload that was neither completed nor aborted stay stored, and billed. This chapter's app never starts a multipart upload. The rule is there anyway because the official documentation recommends it, and so that it isn't forgotten on the day you add support for large files.

`removalPolicy` is `DESTROY`. Destroying the stack deletes the bucket, once it has been emptied.

### What the function may do

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{uploads-role}

The function is allowed five operations on keys that start with `u/`. The function itself never calls `s3:PutObject` or `s3:PutObjectTagging`. The browser's upload performs them, using the function's signature. If the role that signed lacks the permission, the permit doesn't work.

`s3:ListBucket` is not there for listing. According to the official documentation, `HeadObject` on a key that does not exist returns 404 if the caller has this permission and 403 if not. A 403 cannot tell "not uploaded yet" from "not allowed".

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{routes}

The tests check the template for the following.

- Both buckets have all four Block Public Access settings on
- The uploads bucket's policy contains no `Allow` at all
- There is one CORS rule, its only method is `POST`, and it contains no `*`
- The lifecycle rules are the two above: the pending tag and multipart uploads
- The function's S3 permissions are the six operations above, with no `*` action and no `*` resource
- Every route except `/health`, the four new ones included, has the JWT authorizer and a scope

The resource types are the same 19 as in chapter 06. The uploads bucket adds no new type. The pinned cdkd has a dedicated implementation for `AWS::S3::Bucket`, and its package contains code that handles the lifecycle and CORS settings; we looked. The three types without a dedicated implementation (`AWS::CloudFront::Function`, `AWS::Cognito::UserPoolClient`, `AWS::Cognito::UserPoolDomain`) are the same as in chapter 06.

## Deploying

<!-- section: 07.deploy -->

From here on, nothing has been run. The steps and tasks are prepared, and that's where it stops.

```bash
vp run uploads:infra:diff
vp run uploads:infra:deploy
vp run uploads:user:create you@example.com
vp run uploads:publish
vp run uploads:smoke:web
vp run uploads:smoke:api
```

The flow is chapter 06's. The difference is `uploads:smoke:api`. Run it with an access token in the environment variable `AIH_ACCESS_TOKEN` and it tries the following against the real bucket.

- That S3 refuses three uploads: a file that is too large, a different `Content-Type`, and a different key
- That a small PNG can be sent, finished, and found in the list
- That the returned URL returns the image without a token
- That after a delete, the same URL no longer returns the image

Most of this chapter's "not yet" can be settled by this task. Without a token, it only checks that requests without one are turned away, and prints that the upload path was not checked.

This is a different stack from chapter 06's (`AihNotesApp`). The user pool and the table are different too, so with both deployed, users and notes are separate.

Checking for drift is the same as before.

```bash
vp run uploads:infra:drift
```
