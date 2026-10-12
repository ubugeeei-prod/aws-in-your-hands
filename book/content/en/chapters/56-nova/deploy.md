---
title: "56 Nova: Deploy"
---

# 56 Nova: Deploy

This page puts the API you [ran locally](/en/chapters/56-nova/local.md) on Lambda. It goes through the stack in the order model, bucket, permissions, function, and then gives the steps to deploy. From the deploy onwards, nothing on this page has been run at the time of writing.

## The stack

<!-- section: 56.stack -->

The stack takes the route to use for descriptions as `-c describeModel=...` and checks it against the list from the first page.

<<< @/examples/56-nova/infra/lib/nova-stack.ts{model}

An ID that is not in the list, or the ID of a model that cannot read an image, stops the synth. For a retired model it prints the date the model ended. The reason is the one chapter 17 had for stopping the synth on an unchecked ID: without a route, the ARNs for IAM cannot be decided.

There is one bucket.

<<< @/examples/56-nova/infra/lib/nova-stack.ts{bucket}

Its public access settings are those of chapter 07's bucket, and leave no way to make an object public. The lifecycle rule applies to `c/` only. A claim is deleted by the request that made it. One left behind by a function that stopped partway is ignored once its lease is over, and S3 removes it a day later. Descriptions have no expiry.

This stack has a bucket of its own for practice. In the notes app you would use chapter 07's bucket as it is and add the following permissions to the function's role.

<<< @/examples/56-nova/infra/lib/nova-stack.ts{role}

The S3 permissions are split by prefix. Uploads under `u/` are read only: the function never changes an image. That read permission is also what is used when Bedrock fetches the image. Only `g/`, for descriptions, and `c/`, for claims, can be written. The S3 documentation says a write with `If-Match` needs `s3:GetObject` as well as `s3:PutObject`.

The Bedrock permissions are the ARNs the list's function returned, as they are. For the default `jp.amazon.nova-2-lite-v1:0` that is one profile and the model in two Regions, Tokyo and Osaka. As in chapter 17, the statement on the models carries a condition that limits it to calls made through that profile. When an In-Region route is chosen there is no profile, so only the one model in Tokyo is named. The action is `bedrock:InvokeModel`, which is what authorizes `Converse`. Nothing streams, so chapter 17's `bedrock:InvokeModelWithResponseStream` is not granted.

The function and the URL are almost those of chapter 17.

<<< @/examples/56-nova/infra/lib/nova-stack.ts{function}

The timeout is 40 seconds: longer than the 30 seconds the model is waited for, and shorter than the 60-second lease. The function URL's authentication is `AWS_IAM`, and response streaming is not used.

The function's entry point is chapter 04's adapter.

<<< @/examples/56-nova/src/lambda.ts{handler}

The event a function URL hands to a function has the same shape as an API Gateway HTTP API's, so chapter 04's `handleApiGateway` fits as it is. The owner is taken from that event.

The stack's tests pin the following. The list of actions the role is allowed. That `u/` has read access only. That the Bedrock resources are exactly the ARNs for each kind of route. That the bucket cannot be made public. That the URL requires a signature. That the synth stops for a retired model. And the resource types in use. There are seven types, and the pinned cdkd (0.296.28) has a dedicated implementation for every one.

Up to producing the template, this can be checked on your machine.

```bash
vp run nova:infra:synth
```

## Deploying and calling it

<!-- section: 56.deploy -->

From here on, AWS is changed. The steps are the same as in chapter 02.

```bash
vp run nova:infra:diff
vp run nova:infra:deploy
```

Once it is deployed, first check the list against the account.

```bash
vp run nova:models
```

This is the part of the task that compares.

<<< @/examples/56-nova/scripts/models.ts{compare}

If a route in the list is missing on the account's side, the task ends in failure. Either the model has ended or the documentation was misread. In both cases, start by correcting `src/catalog.ts`.

Next, have one image described through the deployed URL.

```bash
vp run nova:smoke
```

This task is billed. It calls the model once, for one image and a few dozen tokens. In order, it does the following.

- Sends an unsigned request and confirms it is refused with 403
- Calls `/me` with a signed request and receives its own prefix
- Uploads one image under that prefix with your credentials. Without a file given by `--image`, it uses a 1 by 1 pixel PNG
- Has the description made with PUT, and asks again with GET if the answer is 202
- Sends the PUT once more and confirms that `reused` is `true` and `createdAt` has not changed
- Deletes the description and the upload

The requests are signed the way chapter 17 signed them.

<<< @/examples/56-nova/scripts/sign.ts{sign}

The drift check is the same as in chapter 02.

```bash
vp run nova:infra:drift
```
