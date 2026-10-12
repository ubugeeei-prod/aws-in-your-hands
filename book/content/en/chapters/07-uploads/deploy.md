---
title: "07 File Upload: Deploy"
---

# 07 File Upload: Deploy

This page covers the infrastructure and the steps for putting the app you [ran locally](/en/chapters/07-uploads/local.md) on AWS. The deployment steps are prepared and have not been run yet.

## Getting ready for AWS

<!-- section: 07.infra -->

The stack (`AihUploads`) is chapter 06's stack with one bucket, two permissions, and four routes added.

### The bucket

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{uploads-bucket}

Block Public Access has all four settings enabled. Neither an ACL nor a bucket policy can make an object in this bucket public. A presigned URL is not public access. It is a request signed by the role, so it works under these settings.

CORS allows two origins (the deployed SPA and the local development server) and only the `POST` method. JavaScript in the browser needs this to read the result of a POST to another origin. Showing an image with `<img>` needs no CORS rule, so `GET` isn't included.

There are two lifecycle rules. One is the cleanup of pending objects described in [Cleaning up what is left](/en/chapters/07-uploads/build.md). The other aborts incomplete multipart uploads. A multipart upload sends a large object in parts, and parts that were neither completed nor aborted stay stored and keep costing money. This chapter's app never starts a multipart upload. The rule is included anyway because the official documentation recommends it, and so that it isn't forgotten when large files are supported later.

`removalPolicy` is `DESTROY`. Deleting the stack deletes the bucket once it has been emptied.

### What the function may do

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{uploads-role}

The function is allowed five operations on keys that start with `u/`. The function itself never calls two of them, `s3:PutObject` and `s3:PutObjectTagging`. The browser's upload performs them using the function's signature. If the role that signed lacks the permission, the permit doesn't work.

`s3:ListBucket` is not there for listing. According to the official documentation, `HeadObject` on a key that doesn't exist returns 404 when the caller has this permission and 403 when it doesn't. A 403 can't distinguish an object that hasn't been sent yet from a missing permission.

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{routes}

The tests check the following against the template.

- Both buckets have all four Block Public Access settings enabled
- The upload bucket's policy contains no `Allow`
- There is one CORS rule, its only method is `POST`, and it doesn't include `*`
- The lifecycle rules are exactly two, the pending tag and multipart uploads
- The function's S3 permissions are the six operations above and nothing else, with no `*` action and no `*` resource
- Every route other than `/health`, including the four added ones, has the JWT authorizer and a scope
- The stage has the same throttling as in chapter 06 (10 requests a second, bursts of 20), and the table has the same request unit caps

Throttling applies to the added routes as well. A request for a permit can't get through faster than 10 a second either.

The stack uses the same 19 resource types as chapter 06. The upload bucket adds no new type. The pinned cdkd has a dedicated implementation for `AWS::S3::Bucket`, and its package was checked to contain code that handles the lifecycle and CORS settings. The three types without a dedicated implementation (`AWS::CloudFront::Function`, `AWS::Cognito::UserPoolClient`, `AWS::Cognito::UserPoolDomain`) are the same as in chapter 06.

## Deploy

<!-- section: 07.deploy -->

The steps from here on have not been run. The steps and the tasks are prepared, and that is all.

```bash
vp run uploads:infra:diff
vp run uploads:infra:deploy
vp run uploads:user:create you@example.com
vp run uploads:publish
vp run uploads:smoke:web
vp run uploads:smoke:api
```

The steps are the same as in chapter 06. The difference is `uploads:smoke:api`. When you run it with an access token in the environment variable `AIH_ACCESS_TOKEN`, it tries the following against the real bucket.

- S3 refuses all three of a file that is too large, a different `Content-Type`, and a different key
- A small PNG can be sent and finished, and it appears in the list
- The URL that comes back returns the image without a token
- After a delete, the same URL no longer returns the image

This task can confirm most of what this chapter has not yet checked. Without a token, it checks only that a request with no token is rejected, and prints that the upload path was not checked.

This stack is separate from chapter 06's stack (`AihNotesApp`). The user pool and the table are separate too, so if you deploy both, each has its own users and notes.

The drift check is the same as in earlier chapters.

```bash
vp run uploads:infra:drift
```
