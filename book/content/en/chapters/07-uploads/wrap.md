---
title: "07 File Upload: Costs, Pitfalls, and Cleanup"
---

# 07 File Upload: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It covers how this setup differs from Cloudflare R2, what it costs, where people get stuck, and what to change for production, and then it removes what you built.

## If you're coming from R2

Cloudflare R2 has presigned URLs too. According to R2's official documentation, the supported operations are `GET`, `HEAD`, `PUT`, and `DELETE`, and POST uploads through an HTML form are not currently supported. So this chapter's `content-length-range` method can't be taken to R2 as it is. The same documentation says that presigned URLs work only on the S3 API domain and can't be used with custom domains, and that they should be treated as bearer tokens.

If you use R2 from Workers, you will often skip presigned URLs and read and write from inside the Worker through a binding. In that setup the image passes through the Worker. That is the approach this chapter avoided, sending the image through the function, although the limits and the price of doing so differ between a Worker and Lambda. The limits and prices on the Worker side have not been checked.

## Cost

Amounts are in USD, for the Tokyo Region, before tax. The inputs and unit prices behind the calculations are in [Pricing Worksheets](/en/reference/pricing.md).

S3 charges for three things. The first is the amount stored, at USD 0.025 per GB a month for the first 50 TB. The second is the number of requests, at USD 0.0047 per 1,000 PUT, POST, or LIST requests and USD 0.0037 per 10,000 GET and other requests. The third is the data leaving S3 for the internet, at USD 0.114 per GB for the first 10 TB. Data coming from the internet into S3 costs USD 0.

As an example, take 10,000 images of 1 MB uploaded in a month and images displayed 100,000 times. The table counts only what is added on top of the cost of chapter 06's app.

| Item | List price |
| --- | --- |
| S3 storage (10 GB) | 0.25 |
| S3 requests (10,000 POST, 10,000 HEAD, 100,000 GET) | 0.09 |
| Data transfer out of S3 (about 97.7 GB) | 11.13 |
| The API side (API Gateway, Lambda, logs, and DynamoDB for 120,000 requests) | 0.29 |
| Subtotal | **11.76** |

Almost all of it is data transfer. Serving images costs more than storing them. This calculation assumes the browser cache doesn't help at all. A presigned URL is different every time, so when the URL changes the browser loads the same image again. For an app with many views, consider putting CloudFront in front.

The subtotal after the monthly free allowances is 11.67. What is deducted, though, is the Lambda and logs allowances, and those are shared with chapter 06's usage. At 1 million requests a month, as in chapter 06's example, no Lambda allowance is left. The data transfer price is described as applying beyond the free tier, but the size of that free tier could not be confirmed, so nothing is deducted for it. An S3 free tier is treated the same way.

Storing tags is charged too, but a tag stays on an object only until the upload is finished, so it is not in the calculation. According to the official documentation, the request that removes the tag is not charged for.

**In a month when nobody uses the app, the stored images still cost storage.** 10 GB is USD 0.25 a month. Objects left without a record are counted at the same price, which is why the sweep is needed.

Deleting the stack deletes the bucket and the images in it. What remains is listed under "Cleaning up".

### When it gets hammered

The API side is the same as in chapter 06. Someone who isn't signed in reaches `/health` and nothing else. The stage's throttling is 10 requests a second, and the table has its request unit caps. The table under "When it gets hammered" in chapter 06 (USD 182.83 a month) is the ceiling for this chapter's API as well. What this chapter adds is the `HeadObject` that each finish call sends, and even if all 25.92 million requests were finish calls, that would be USD 9.59.

What is new in this chapter is a path that doesn't go through the API. Requests made with permits and view URLs go straight to S3, so API Gateway's throttling doesn't apply to them. The list below takes that path in three parts: how much is stored, how many uploads are made, and how often images are read.

- The amount stored is capped. Unfinished objects stop at 100 per person per day, 500 MB. They are deleted a day later, so even if someone stays at the cap every day, about 0.5 GB is stored at a time, about USD 0.01 a month (more if S3 is late deleting). Images that were attached stop at 100 notes × 10 images × 5 MB per person, which is about 4.9 GB, USD 0.12 a month
- The number of uploads is not capped. A permit works any number of times for 5 minutes. Each use overwrites the same key, so the amount stored doesn't grow, but a POST to S3 costs USD 4.70 per million. How many requests a second S3 accepts has not been checked in this book
- Reading images is not capped. For 5 minutes, anyone holding a view URL can read it as often as they like. The cost is data transfer: one 5 MB image read 10,000 times is 48.8 GB, USD 5.57. This is the charge that can grow largest in this chapter

Only a signed-in user, or someone that user passed a URL or a form to, can use the two uncapped paths. The only users are the ones you created, so a stranger can't reach this path directly. If you open the app to users widely, though, you will want it closed. Serving the images from CloudFront lets the cache work and lets you attach AWS WAF ([chapter 21](/en/chapters/21-security.md): USD 5 a month for the web ACL, USD 1 a month per rule, USD 0.60 per million requests inspected; chapter 21's setup has three rules, so it starts at USD 8.00 a month). This book doesn't build image delivery through CloudFront.

## Where people get stuck

| If you see this | Look here |
| --- | --- |
| `dev:uploads:api` stops with a message that mentions `UPLOADS_STORE` | Check that `examples/07-uploads/.env` exists. If it doesn't, copy `.env.example` |
| The screen says "The upload was refused (HTTP 403)" | Check whether more than 5 minutes passed since the permit was issued. If so, choose the file again |
| The POST to S3 returns 403 | A form field whose value differs from the policy doesn't meet its condition. Check that you send the `fields` the SDK returned unchanged, with the `file` field last. What S3 actually puts in the response has not been checked yet |
| The POST to S3 shows up as a CORS error in the browser console | Check that the SPA's origin matches the bucket's CORS `AllowedOrigins` exactly. Look at the status code with `curl` first |
| The finish call returns 409 `upload_missing` | Check whether the POST to S3 returned 204. If it didn't, there is no object |
| The finish call returns 500 and the log shows a 403 | Without `s3:ListBucket` on the execution role, `HeadObject` on a key that doesn't exist returns 403 |
| Asking for a permit returns 429 `upload_quota_exceeded` | That user has already received 100 permits today (UTC). Unused ones count too. Requests go through again when the date changes |
| The finish call returns 409 `upload_rejected` | More than 15 minutes passed since the upload. Send the file again |
| An image stops showing after a while | The URL's expiry (5 minutes) has passed. The screen fetches the list again. If that doesn't fix it, the object is gone |
| S3 returns `ExpiredToken` | The credentials that signed the URL have expired. Fetching the list again returns URLs signed with new credentials |

## If you take this to production

- Prevent the same form from being sent twice. [The gap this design leaves](/en/chapters/07-uploads/build.md) explains why
- Run the sweep on a schedule. As a task run by hand, it will be forgotten one day ([chapter 08](/en/chapters/08-async.md))
- Inspect the content. S3 doesn't check whether a file really is an image, so add a check that runs after the upload
- Reconsider delivery. With many views, put CloudFront in front. Both the data transfer charges and the caching change
- Protect the bucket. Set `removalPolicy` to `RETAIN` and consider versioning. With versioning on, lifecycle rules behave differently
- Choose the caps again. 10 images per note, 100 notes per person, and 100 permits per person per day are all practice values. Decide yours from how your app is used. Delete the per-date permit counts with the table's TTL
- Close the paths that go straight to S3. As "When it gets hammered" says, nothing caps the number of uploads or the reading of images
- Remove the local origin. Take `http://localhost:5173` out of the bucket's CORS and the API's CORS
- Record access. The API's logs don't show who used a presigned URL. You need records on the S3 side (this book doesn't cover them)

## Cleaning up

<!-- section: 07.cleanup -->

```bash
vp run uploads:empty --yes
vp run uploads:unpublish --yes
vp run uploads:infra:destroy
```

The pinned cdkd doesn't delete a bucket that isn't empty, so empty the two buckets first. `uploads:empty` deletes the uploaded images and `uploads:unpublish` deletes the SPA's files. Without `--yes`, both only count what they would delete.

`uploads:infra:destroy` deletes the buckets, the table, the user pool, the function, the API, and the distribution. Images, notes, and users can't be restored.

What remains is the storage created by the cdkd bootstrap (chapter 02) and the deployment files placed in it.

::: details Verification notes for this chapter

**Checked locally.** These tests and checks were run: the API tests (authorization, what a permit contains, finishing, the deadline, the cap), the tests that stop partway (the six rows of the table in [Tests that stop it partway](/en/chapters/07-uploads/build.md), the sweep, and the same form sent twice), key building, the contents of the POST policy and the presigned GET that the SDK produces (signed with made-up credentials and never sent to S3), the shape of the DynamoDB requests, the infrastructure assertions, type checking, the SPA build, and synth. With `dev:uploads:api` and `dev:uploads:web` running, a browser was also driven automatically to check the following: signing in, creating a note, choosing a file and seeing the image displayed, a 404 for another user's permit, list, and finish, refusal of a file that is too large, a different type, and a different key, the same result from calling finish twice, and the image URL no longer loading after a delete and after deleting the note. The caps added here were checked with tests. One person's 101st permit is a 429, other users are unaffected, the permits come back when the date changes, and a request refused for another reason isn't counted. A 101st note is a 409. Both were checked through `composeApp`. The template has the throttling on the stage and the request unit caps on the table.

**Not checked yet.** Nothing has been run against AWS. None of `uploads:infra:deploy`, `uploads:user:create`, `uploads:publish`, `uploads:smoke:web`, `uploads:smoke:api`, `uploads:sweep`, `uploads:infra:drift`, `uploads:empty`, `uploads:unpublish`, or `uploads:infra:destroy` has been run. So the following have not been checked on real S3: that S3 accepts a presigned POST with a `tagging` field, that S3 refuses on the `content-length-range` and `Content-Type` conditions and with what response, that a POST from the browser passes the bucket's CORS rule, that `HeadObject` right after the POST finds the object (the statement on strong consistency names PUT and DELETE and does not name POST Object), that the lifecycle rule deletes pending objects, and that it leaves objects alone after `DeleteObjectTagging`. The DynamoDB implementation (`dynamodb-attachment-repository.ts`) only has the shape of its requests pinned by tests and has been sent to neither DynamoDB Local nor the real service. The lifetime of the execution role's credentials could not be confirmed in the official documentation. No S3-compatible local implementation was used (the Docker daemon was not running). The caps have not been checked against the real services either. The conditional update that counts permits (`permit-ledger.ts`) only has the shape of its request pinned by a test. Whether cdkd 0.296.28 applies the stage's `DefaultRouteSettings` and the table's `OnDemandThroughput`, and whether throttling is counted for the whole API or per route (this chapter has 11 routes), are unchecked as in chapter 06. How many POSTs a second S3 accepts for one key was not looked up. The amounts in "When it gets hammered" are computed from unit prices and assumptions.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Issue the permit | `examples/07-uploads/api/src/contract.ts`, `api/src/object-store.ts`, `api/src/s3-object-store.ts`, `api/test/s3-object-store.test.ts` | `test:unit` |
| The API decides the key | `examples/07-uploads/api/src/keys.ts`, `api/src/attachments.ts`, `api/src/app.ts`, `api/src/permit-ledger.ts`, `api/test/keys.test.ts`, `api/test/app.test.ts`, `api/test/permit-ledger.test.ts`, `api/test/compose.test.ts` | `test:unit` |
| Two stores, one order | `examples/07-uploads/api/src/attachments.ts`, `api/src/attachment-repository.ts`, `api/src/dynamodb-attachment-repository.ts`, `api/src/client.ts`, `api/test/partial-failure.test.ts`, `api/test/harness.ts` | `test:unit` |
| Cleaning up what is left | `examples/07-uploads/api/src/sweep.ts`, `scripts/sweep.ts`, `infra/lib/uploads-stack.ts` | `test:unit`, `uploads:sweep` |
| Showing the image | `examples/07-uploads/api/src/s3-object-store.ts`, `api/src/attachments.ts`, `api/src/lambda.ts` | `test:unit` |
| Running it locally | `examples/07-uploads/api/src/dev.ts`, `api/src/memory-object-store.ts`, `api/src/local-store-http.ts`, `api/src/compose.ts`, `api/src/env.ts`, `.env.example`, `web/` | `dev:uploads:api`, `dev:uploads:web`, `typecheck:uploads:web`, `lint:uploads:web`, `build:uploads:web` |
| Getting ready for AWS | `examples/07-uploads/infra/lib/uploads-stack.ts`, `infra/bin/app.ts`, `infra/test/uploads-stack.test.ts`, `cdk.json` | `uploads:infra:synth`, `test:unit` |
| Deploying | `examples/07-uploads/scripts/write-config.ts`, `scripts/user.ts`, `scripts/smoke.ts`, `tools/src/site/`, `tools/src/infra/` | `uploads:infra:diff`, `uploads:infra:deploy`, `uploads:user:create`, `uploads:publish`, `uploads:smoke:web`, `uploads:smoke:api`, `uploads:infra:drift` |
| Cleaning up | `examples/07-uploads/scripts/empty-uploads.ts`, `scripts/user.ts`, `tools/src/site/unpublish.ts` | `uploads:empty`, `uploads:unpublish`, `uploads:infra:destroy`, `uploads:user:delete` |
| Cost | `data/pricing/` | `test:unit` |

**Primary sources** (all checked on 2026-10-11)

- [Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), [Uploading objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [POST Policy](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html), [POST Object](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/RESTObjectPOST.html), [Authenticating Requests: Using Query Parameters](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html). On the day they were checked, the earlier URLs of these three under `/AmazonS3/latest/API/` redirected to the table of contents, so they were read under `/developerguide/`
- [How to prevent object overwrites with conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)
- [Working with Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html), [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [Expiring objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html), [Configuring a bucket lifecycle configuration to delete incomplete multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html), [Tagging your objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.html)
- [Using cross-origin resource sharing (CORS)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html), [Elements of a CORS configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html), [Blocking public access to your Amazon S3 storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html) (strong consistency)
- AWS Price List bulk API: [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json), [Data Transfer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json)
- [@aws-sdk/s3-presigned-post 3.1149.0](https://www.npmjs.com/package/@aws-sdk/s3-presigned-post/v/3.1149.0) (type definitions and source)
- [Cloudflare R2: Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
