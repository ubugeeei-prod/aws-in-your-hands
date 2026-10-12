---
title: "10 Edge: Deploy"
---

# 10 Edge: Deploy

By the end of the [previous page](/en/chapters/10-edge/local.md), the edge function and the sync script that changes KVS both ran on your machine. This page deploys them to AWS, and its second half adds one Lambda@Edge function.

## Getting ready for AWS

<!-- section: 10.infra -->

The CDK stack is the stack from chapter 03 with a KVS added.

<<< @/examples/10-edge/infra/lib/edge-stack.ts{store}

The KVS is created empty. CDK can also import keys and values from a file at creation time (an import source), but this stack doesn't use that. An import happens only when the KVS is first created, so a later fix to `edge-data.json` would not be picked up, and forcing it would mean recreating the KVS. Ownership is split instead: the stack manages the KVS itself, and `edge-data.json` and the sync script manage what is in it.

A newly created KVS is empty, and that causes no problem. The function is written to pass the request through unchanged when a key is missing.

<<< @/examples/10-edge/infra/lib/edge-stack.ts{router}

When you pass `keyValueStore`, CDK associates the function with the KVS. The runtime is set to 2.0 explicitly.

The tests in `infra/test/edge-stack.test.ts` check that the bucket is private and that only this distribution can read it, that the function uses runtime 2.0 and has exactly one KVS attached, that the KVS is created empty and removed with the stack, and which resource types the stack uses.

### How cdkd handles these resources

I read the source of the pinned cdkd version (0.296.28) to see how it handles each resource type.

| Resource type | How cdkd handles it |
| --- | --- |
| `AWS::S3::Bucket`, `AWS::S3::BucketPolicy` | Dedicated implementation |
| `AWS::CloudFront::Distribution`, `AWS::CloudFront::OriginAccessControl` | Dedicated implementation |
| `AWS::CloudFront::Function` | Through the Cloud Control API |
| `AWS::CloudFront::KeyValueStore` | Through the Cloud Control API. Treated as stateful |

"Treated as stateful" means that cdkd has KVS on its list of resource types that lose data when they are removed. If you make a change that requires replacing the KVS, such as renaming it, cdkd stops and asks you to run again with `--force-stateful-recreation`. The contents can be put back with the sync script at any time, so for this chapter's KVS you can add the flag. A recreated KVS starts out empty, though. The function runs with an empty KVS, but the redirects and flags have no effect until you sync again.

All of this comes from reading the source. I haven't yet confirmed that cdkd can create these resources in a real AWS account.

## Deploying and switching

<!-- section: 10.deploy -->

```bash
vp run edge:infra:diff
vp run edge:infra:deploy
vp run edge:publish
```

These three commands show the diff, deploy the stack, and put the three HTML files from `site/` in the bucket. The KVS is still empty at this point, so `/` returns `index.html` and `/plans` returns a 404.

Next, put the table into KVS. Look at the diff first, then write it.

```bash
vp run edge:kvs:plan
vp run edge:kvs:sync
```

`edge:kvs:plan` only reads KVS and changes nothing. `edge:kvs:sync` prints the plan it sent and the new ETag.

```bash
curl -sI https://dxxxxxxxxxxxx.cloudfront.net/plans | head -n 3
```

If you get a 301 with `location: /pricing/`, the table has arrived. If you try right after the sync and get a 404, wait a little and try again. You may be between t0 and t2 in the [figure on the previous page](/en/chapters/10-edge/local.md), with the value not yet at that edge location.

Try the maintenance switch as well. Set `maintenance` to `true` in `edge-data.json`, sync, and check the status code a few times.

```bash
vp run edge:kvs:sync
curl -s -o /dev/null -w '%{http_code}\n' https://dxxxxxxxxxxxx.cloudfront.net/
```

For a while you may see a mix of 200 and 503. That mix is what eventual consistency means. When you have finished, set the value back to `false` and sync once more.

The drift check is the same as in earlier chapters.

```bash
vp run edge:infra:drift
```

The contents of the KVS (its keys and values) are not in the template, so the drift check doesn't cover them. Use `edge:kvs:plan` to see whether the contents have drifted. If someone changed them by any means other than the sync script, such as the console, the change shows up as a diff.

I haven't yet been able to run the steps in this section against real AWS.

## Reading the body with Lambda@Edge

<!-- section: 10.lambda-edge -->

The cases where CloudFront Functions fall short are well defined: you want to call an external API or a database, look at the request body, do work that doesn't finish in milliseconds, run just before or just after the origin, or use a library from npm.

One option in those cases is Lambda@Edge. CloudFront takes an ordinary Lambda function ([chapter 04](/en/chapters/04-http-api.md)), replicates it around the world, and invokes it partway through a request. It has network access and can read the body. In exchange, it comes with more restrictions than a regular Lambda function.

- The function is created in `us-east-1`. It can't be created in Tokyo
- You specify a numbered version. Neither `$LATEST` nor an alias works, so every change to the code means publishing a new version and updating the distribution
- Environment variables can't be used, apart from the reserved ones. Settings are built into the code or fetched from somewhere at run time
- The function can't be placed in a VPC. Layers, X-Ray, dead letter queues, provisioned concurrency, and container images can't be used either
- arm64 can't be used. Only x86_64 is supported
- The execution role must be assumable by both `lambda.amazonaws.com` and `edgelambda.amazonaws.com`
- The timeout can be 30 seconds at most
- A response the function generates can be up to 40 KB on viewer events and 1 MB on origin events
- The body is truncated at 40 KB on viewer request and 1 MB on origin request. For a longer body, the function receives only the beginning

There are rules about combining functions as well. Each event of a cache behavior can have only one function attached. On the viewer events (viewer request and viewer response), you also can't mix CloudFront Functions and Lambda@Edge. A CloudFront Function on viewer request with Lambda@Edge on origin request is allowed, and this chapter uses that combination.

### A minimal example that returns a digest of the body

This small example does one thing CloudFront Functions can never do. The function returns the size and the SHA-256 of a POSTed body.

<<< @/examples/10-edge/src/lambda-edge/body-digest.ts{digest}

The function runs on origin request and returns its own response without asking the origin. It puts `truncated` in the response because, for a body over 1 MB, the function receives only the beginning. A digest of the beginning must not be presented as a digest of the whole body.

This function exists to show that the setup works. The closest real use is probably verifying a webhook signature, where you compute an HMAC over the whole body and refuse the request before it reaches the origin if the HMAC doesn't match. Verification needs a secret key, though. Environment variables aren't available, so the function has to fetch the key over the network from something like Secrets Manager, and then you have latency, cost, and permissions to think about. The price of doing work at the edge usually shows up in this form.

The event comes from outside the type system, so a schema checks the parts the function uses.

<<< @/examples/10-edge/src/lambda-edge/body-digest.ts{event}

### A stack outside Tokyo

<<< @/examples/10-edge/infra/bin/app.ts{stacks}

A Lambda@Edge function can only be created in `us-east-1`, so this one stack is in a different Region. It is separate from the stack that holds the distribution, and the two are connected by passing the version's ARN by hand. CDK also has a construct that connects them across Regions automatically (`EdgeFunction`). It adds a custom resource and another stack behind the scenes, however, and I couldn't fully trace how cdkd handles those. The chapter therefore uses the form in which everything that gets created is visible.

<<< @/examples/10-edge/infra/lib/body-digest-stack.ts{role}

The logging permission uses `*` for the Region. This book has kept to not using `*`, but here it can't be avoided. A Lambda@Edge function writes its logs in a Region near where it ran, and which Region that is depends on where readers are. The log group's name is `/aws/lambda/us-east-1.<function name>` in every Region, so the name itself is fixed in the policy.

<<< @/examples/10-edge/infra/lib/body-digest-stack.ts{function}

`awsSdkConnectionReuse: false` is easy to miss. Unless told otherwise, CDK's `NodejsFunction` adds one environment variable. Lambda@Edge refuses a function that has environment variables, so the option turns that off. The tests check that the template has no environment variables, no VPC configuration, and no layers.

On the distribution's side, the behavior is added only when a version ARN is passed in.

<<< @/examples/10-edge/infra/lib/edge-stack.ts{digest}

This behavior has caching disabled and accepts every method. Only POST needs to get through, but CloudFront offers three choices, "GET and HEAD", "those plus OPTIONS", and "all", and POST is only in "all". Left like that, a GET or a DELETE would also run Lambda@Edge and cost money on every request.

So the CloudFront Function in front refuses everything except POST.

<<< @/examples/10-edge/infra/functions/edge-router.js{digest}

The three lines at the top of `handler`, which you read on the [first page](/en/chapters/10-edge.md), call this `methodNotAllowed`. It returns before KVS is read, so a refusal costs the CloudFront request charge and one function invocation and nothing more.

POST is not stopped. Every POST that arrives runs Lambda@Edge. Nothing in this setup limits how many there can be, and "When it gets hammered" on the [costs page](/en/chapters/10-edge/wrap.md) gives the numbers. When you have finished trying it out, the surest thing is to deploy again without `-c bodyDigestVersionArn`, which removes the whole behavior.

The shape of the ARN is checked when it is passed to the stack.

<<< @/examples/10-edge/infra/lib/edge-stack.ts{props}

`$LATEST`, an alias, or an ARN in another Region fails at synth. You find out much sooner than you would from CloudFront refusing it partway through a deploy.

### Deploying it

```bash
AIH_AWS_REGION=us-east-1 vp run infra:bootstrap
vp run edge:body:infra:deploy
vp run edge:infra:deploy -c bodyDigestVersionArn=arn:aws:lambda:us-east-1:123456789012:function:aih-edge-body-digest:1
curl -s -X POST --data 'hello edge' https://dxxxxxxxxxxxx.cloudfront.net/digest
```

The output of the second line includes `BodyDigestVersionArn`. Pass that value to the third line.

This procedure is the least verified part of the chapter. As far as I can tell from cdkd's source, when a stack names a Region, cdkd uses that Region. The built function code probably also needs somewhere to live in `us-east-1`, which is what the first line sets up. I haven't run any of these commands, though. cdkd handles `AWS::Lambda::Version` through the Cloud Control API (`AWS::Lambda::Function`, `AWS::IAM::Role`, and `AWS::IAM::Policy` have dedicated implementations). I also haven't separately confirmed that Node.js 24 works on Lambda@Edge, because the documentation says only that the latest Node.js is supported.
