---
title: "07 File Upload: Costs, Pitfalls, and Cleanup"
---

# 07 File Upload: Costs, Pitfalls, and Cleanup

## If you're coming from R2

Cloudflare R2 has presigned URLs too. According to R2's official documentation, the supported operations are `GET`, `HEAD`, `PUT`, and `DELETE`, and POST uploads through an HTML form are not currently supported. So this chapter's `content-length-range` approach does not carry over to R2 as it is. The same documentation says that presigned URLs work only on the S3 API domain and cannot be used with custom domains, and that they should be treated as bearer tokens.

If you use R2 from Workers, you may well skip presigned URLs and read and write from inside the Worker through a binding. In that design the image passes through the Worker. That is the "through the function" approach this chapter avoided, though the limits and the price of passing through differ between a Worker and Lambda. We did not check those limits and prices.

## What it costs

Amounts are in USD, for the Tokyo Region, before tax. The inputs and unit prices are in [Pricing calculations](/en/reference/pricing.md).

S3 charges for three things. The amount stored (USD 0.025 per GB a month for the first 50 TB). The number of requests (USD 0.0047 per 1,000 PUT, POST, or LIST requests, and USD 0.0037 per 10,000 GET and other requests). And the data leaving S3 for the internet (USD 0.114 per GB for the first 10 TB). Data coming from the internet into S3 costs USD 0.

One example: 10,000 images of 1 MB uploaded in a month, and images displayed 100,000 times. It counts only what is added on top of chapter 06's app.

| Item | List price |
| --- | --- |
| S3 storage (10 GB) | 0.25 |
| S3 requests (10,000 POST, 10,000 HEAD, 100,000 GET) | 0.09 |
| Data transfer out of S3 (about 97.7 GB) | 11.13 |
| The API side (API Gateway, Lambda, logs, and DynamoDB for 120,000 requests) | 0.29 |
| Subtotal | **11.76** |

As you can see, almost all of it is data transfer. Images cost more to hand out than to keep. This calculation assumes the browser cache does not help at all. A presigned URL is different every time, so when the URL changes the browser loads the same image again. For an app with many views, consider putting CloudFront in front.

The subtotal after the monthly free allowances is 11.67. But what is deducted are the Lambda and logs allowances, which are shared with chapter 06's usage. At 1,000,000 requests a month, as in chapter 06's example, no Lambda allowance is left. The data transfer price is described as applying "beyond the free tier", but the size of that free tier was not confirmed, so nothing is deducted for it. The same goes for an S3 free tier.

Storing tags is charged too, but a tag is on an object only until the upload is finished, so it is not in the calculation. The request that removes the tag is not billed, according to the official documentation.

**In a month when nobody uses the app, the stored images are still charged for.** 10 GB is USD 0.25 a month. Orphaned objects are counted at the same price. That is why cleanup matters.

Destroying the stack deletes the bucket and the images in it. What remains is listed under "Cleaning up".

## Where it goes wrong

| When this happens | Look here |
| --- | --- |
| `dev:uploads:api` stops and names `UPLOADS_STORE` | Is there an `examples/07-uploads/.env`? Copy `.env.example` |
| The screen says "The upload was refused (HTTP 403)" | Did more than 5 minutes pass since the permit was issued? Choose the file again |
| The POST to S3 answers 403 | A form field whose value differs from the policy does not meet its condition. Are you sending the `fields` the SDK returned as they are, with the `file` field last? What S3 actually puts in the response has not been checked yet |
| The POST to S3 shows up as a CORS error in the browser console | Does the SPA's origin match the bucket's CORS `AllowedOrigins` exactly? Look at the status code with `curl` first |
| The finish call answers 409 `upload_missing` | Did the POST to S3 answer 204? If not, there is no object |
| The finish call answers 500 and the log shows a 403 | Without `s3:ListBucket` on the execution role, `HeadObject` on a missing key answers 403 |
| The finish call answers 409 `upload_rejected` | More than 15 minutes passed since the upload. Send it again |
| An image stops showing after a while | The URL's lifetime (5 minutes). The screen fetches the list again. If that doesn't help, the object is gone |
| S3 answers `ExpiredToken` | The credentials that signed the URL have expired. Fetch the list again to get URLs signed with fresh ones |

## Before production

- **Close the replay of a form.** See "A gap this design leaves open"
- **Run the sweep on a schedule.** As a task run by hand, it will be forgotten one day ([chapter 08](/en/chapters/08-async.md))
- **Inspect the content.** S3 does not look at whether a file really is an image. Add a check that runs after the upload
- **Rethink delivery.** With many views, put CloudFront in front. Both the data transfer charges and the caching change
- **Protect the bucket.** Set `removalPolicy` to `RETAIN` and consider versioning. With versioning on, lifecycle rules behave differently
- **Set a limit per user.** This chapter's only limit is 10 images per note. Nothing limits how many notes one user creates
- **Remove the local origin.** Take `http://localhost:5173` out of the bucket's CORS and the API's CORS
- **Record access.** Who used a presigned URL does not appear in the API's logs. You need records on the S3 side (this book does not cover them)

## Cleaning up

<!-- section: 07.cleanup -->

```bash
vp run uploads:empty --yes
vp run uploads:unpublish --yes
vp run uploads:infra:destroy
```

The pinned cdkd will not delete a bucket that is not empty, so the two buckets are emptied first. `uploads:empty` deletes the uploaded images and `uploads:unpublish` deletes the SPA's files. Without `--yes`, both only count.

`uploads:infra:destroy` deletes the buckets, the table, the user pool, the function, the API, and the distribution. Images, notes, and users cannot be brought back.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it.

::: details Verification notes for this chapter

**Checked locally.** The API tests (authorization, what a permit contains, finishing, the deadline, the limit), the tests that stop partway (the six rows of the table above, the sweep, and the replay of a form), key building, the contents of the POST policy and the presigned GET that the SDK produces (signed with made-up credentials and never sent to S3), the shape of the DynamoDB requests, the infrastructure assertions, type checking, the SPA build, and synth. In addition, with `dev:uploads:api` and `dev:uploads:web` running, a browser was driven automatically to check the following: signing in, creating a note, choosing a file and seeing the image displayed, a 404 for another user's permit, list, and finish, refusal of a file that is too large, a different type, and a different key, the same result from calling finish twice, and the image URL no longer loading after a delete and after deleting the note.

**Not checked yet.** Nothing has been run against AWS. None of `uploads:infra:deploy`, `uploads:user:create`, `uploads:publish`, `uploads:smoke:web`, `uploads:smoke:api`, `uploads:sweep`, `uploads:infra:drift`, `uploads:empty`, `uploads:unpublish`, or `uploads:infra:destroy`. So the following are unconfirmed on real S3: that S3 accepts a presigned POST with a `tagging` field. That S3 refuses on the `content-length-range` and `Content-Type` conditions, and with what response. That a POST from the browser passes the bucket's CORS rule. That `HeadObject` right after the POST finds the object (the statement on strong consistency names PUT and DELETE, and does not name POST Object). That the lifecycle rule deletes pending objects. That it leaves objects alone after `DeleteObjectTagging`. The DynamoDB implementation (`dynamodb-attachment-repository.ts`) has the shape of its requests pinned by tests and has been sent to neither DynamoDB Local nor the real service. The lifetime of the execution role's credentials could not be confirmed from the official documentation. No S3-compatible local implementation was used (the Docker daemon was not running).

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Writing the permit | `examples/07-uploads/api/src/contract.ts`, `api/src/object-store.ts`, `api/src/s3-object-store.ts`, `api/test/s3-object-store.test.ts` | `test:unit` |
| The API decides the key | `examples/07-uploads/api/src/keys.ts`, `api/src/attachments.ts`, `api/src/app.ts`, `api/test/keys.test.ts`, `api/test/app.test.ts` | `test:unit` |
| Two stores, one order | `examples/07-uploads/api/src/attachments.ts`, `api/src/attachment-repository.ts`, `api/src/dynamodb-attachment-repository.ts`, `api/src/client.ts`, `api/test/partial-failure.test.ts`, `api/test/harness.ts` | `test:unit` |
| Cleaning up what is left | `examples/07-uploads/api/src/sweep.ts`, `scripts/sweep.ts`, `infra/lib/uploads-stack.ts` | `test:unit`, `uploads:sweep` |
| Showing the image | `examples/07-uploads/api/src/s3-object-store.ts`, `api/src/attachments.ts`, `api/src/lambda.ts` | `test:unit` |
| Running it locally | `examples/07-uploads/api/src/dev.ts`, `api/src/memory-object-store.ts`, `api/src/local-store-http.ts`, `api/src/compose.ts`, `api/src/env.ts`, `.env.example`, `web/` | `dev:uploads:api`, `dev:uploads:web`, `typecheck:uploads:web`, `lint:uploads:web`, `build:uploads:web` |
| Getting ready for AWS | `examples/07-uploads/infra/lib/uploads-stack.ts`, `infra/bin/app.ts`, `infra/test/uploads-stack.test.ts`, `cdk.json` | `uploads:infra:synth`, `test:unit` |
| Deploying | `examples/07-uploads/scripts/write-config.ts`, `scripts/user.ts`, `scripts/smoke.ts`, `tools/src/site/`, `tools/src/infra/` | `uploads:infra:diff`, `uploads:infra:deploy`, `uploads:user:create`, `uploads:publish`, `uploads:smoke:web`, `uploads:smoke:api`, `uploads:infra:drift` |
| Cleaning up | `examples/07-uploads/scripts/empty-uploads.ts`, `scripts/user.ts`, `tools/src/site/unpublish.ts` | `uploads:empty`, `uploads:unpublish`, `uploads:infra:destroy`, `uploads:user:delete` |
| What it costs | `data/pricing/` | `test:unit` |

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
