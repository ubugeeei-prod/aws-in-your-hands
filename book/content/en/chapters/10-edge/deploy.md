---
title: "10 Edge: Deploy"
---

# 10 Edge: Deploy

## Getting ready for AWS

<!-- section: 10.infra -->

The CDK stack is the one from chapter 03 plus a KVS.

<<< @/examples/10-edge/infra/lib/edge-stack.ts{store}

The KVS is created empty. CDK can also import keys and values from a file at creation time (an import source), but I didn't use it. Importing is only possible when the KVS is first created. Fixing `edge-data.json` later wouldn't be reflected, and making it reflect would mean recreating the KVS. So ownership is split: the container belongs to the stack, and the contents belong to `edge-data.json` and the sync.

A brand-new KVS is empty, and that's fine. The function is written to let requests through untouched when a key is missing.

<<< @/examples/10-edge/infra/lib/edge-stack.ts{router}

Passing `keyValueStore` makes CDK associate the function with the KVS. The runtime is set to 2.0 explicitly.

The tests (`infra/test/edge-stack.test.ts`) check that the bucket is private and readable only by this distribution. That the function is on runtime 2.0 with exactly one KVS attached. That the KVS is created empty and goes away with the stack. And the list of resource types in use.

### How cdkd handles these resources

I read the source of the pinned cdkd version (0.296.28).

| Resource type | How cdkd handles it |
| --- | --- |
| `AWS::S3::Bucket`, `AWS::S3::BucketPolicy` | Dedicated implementation |
| `AWS::CloudFront::Distribution`, `AWS::CloudFront::OriginAccessControl` | Dedicated implementation |
| `AWS::CloudFront::Function` | Through Cloud Control API |
| `AWS::CloudFront::KeyValueStore` | Through Cloud Control API. Treated as stateful |

"Treated as stateful" means cdkd has KVS on its list of types whose removal loses data. If you make a change that requires replacing the KVS (renaming it, for example), cdkd stops and asks you to run again with `--force-stateful-recreation`. The contents can be put back any time with a sync, so for this chapter's KVS it's fine to pass it. But a KVS that was just recreated is empty. The function works with an empty one, but redirects and flags won't take effect until you sync again.

All of this comes from reading the source. Whether cdkd can actually create these in real AWS is not confirmed yet.

## Deploy it and flip the switches

<!-- section: 10.deploy -->

```bash
vp run edge:infra:diff
vp run edge:infra:deploy
vp run edge:publish
```

That gets the three HTML files in `site/` into the bucket. At this point the KVS is empty, so `/` returns `index.html` and `/plans` is a 404.

Next, load the table. Look at the diff first, then write.

```bash
vp run edge:kvs:plan
vp run edge:kvs:sync
```

`edge:kvs:plan` only reads the KVS and changes nothing. `edge:kvs:sync` prints the plan it sent and the new ETag.

```bash
curl -sI https://dxxxxxxxxxxxx.cloudfront.net/plans | head -n 3
```

A 301 with `location: /pricing/` means the table has arrived. If you try right after the sync and get a 404, wait a little and try again. You may simply be between t0 and t2 from earlier.

Try the maintenance switch too. Set `maintenance` to `true` in `edge-data.json`, sync, and look at the status code a few times.

```bash
vp run edge:kvs:sync
curl -s -o /dev/null -w '%{http_code}\n' https://dxxxxxxxxxxxx.cloudfront.net/
```

There may be a stretch where 200 and 503 are mixed. That's eventual consistency. When you're done, set it back to `false` and sync once more.

The drift check is the same as in earlier chapters.

```bash
vp run edge:infra:drift
```

The contents of the KVS (its keys and values) aren't in the template, so the drift check doesn't cover them. For the contents, use `edge:kvs:plan`. If someone changed them by a route other than the sync (the console, say), it shows up there as a diff.

Honestly, I haven't been able to run the steps in this section against real AWS yet.

## When you need the body: Lambda@Edge

<!-- section: 10.lambda-edge -->

The cases where CloudFront Functions fall short are clear-cut. You want to call an external API or a database. You want to look at the request body. The work doesn't finish in milliseconds. You want to run just before or just after the origin. You want to use an npm library.

One option at that point is Lambda@Edge. CloudFront takes an ordinary Lambda function ([chapter 04](/en/chapters/04-http-api.md)), replicates it around the world, and invokes it partway through a request. It can reach the network, and it can read the body. In exchange, it comes with a lot of rules that feel cramped for a Lambda function.

- **The function is created in `us-east-1`.** Tokyo won't do
- **You name a numbered version.** Neither `$LATEST` nor an alias works. Each time the code changes, you publish a new version and update the distribution
- **No environment variables.** Reserved ones aside. Settings get baked into the code or fetched from somewhere at run time
- **No VPC.** No layers, X-Ray, dead letter queues, provisioned concurrency, or container images either
- **No arm64.** x86_64 only
- **The execution role must be assumable by both `lambda.amazonaws.com` and `edgelambda.amazonaws.com`**
- **A timeout of up to 30 seconds**
- **Size of a response the function generates**: 40 KB on viewer-side events, 1 MB on origin-side events
- **Truncation when reading the body**: 40 KB on viewer request, 1 MB on origin request. A longer body is handed over as its first part only

There's one more rule, about combinations. Each event of a cache behavior can have one function. And on viewer-side events (viewer request and viewer response), you can't mix CloudFront Functions and Lambda@Edge. A CloudFront Function on viewer request together with Lambda@Edge on origin request is allowed. That's this chapter's setup.

### A minimal example: return a digest of the body

Let's do one small thing CloudFront Functions can never do: a function that returns the size and SHA-256 of a POSTed body.

<<< @/examples/10-edge/src/lambda-edge/body-digest.ts{digest}

It runs on origin request and answers by itself, without asking the origin. `truncated` is in the response because, for a body over 1 MB, the function only sees the first part. A digest of the first part must not pass itself off as a digest of the whole.

This one exists just to see it work. The closest real use is probably verifying a webhook signature: compute an HMAC over the whole body and turn the request away before it reaches the origin if it doesn't match. But that needs a secret key. Environment variables aren't available, so you'd fetch it over the network from something like Secrets Manager, and now you're talking about latency, cost, and permissions. The price of "doing it at the edge" usually shows up in this form.

The event is a value from outside the type system. A schema checks just the part that's used.

<<< @/examples/10-edge/src/lambda-edge/body-digest.ts{event}

### A stack outside Tokyo

<<< @/examples/10-edge/infra/bin/app.ts{stacks}

A Lambda@Edge function can only be created in `us-east-1`, so this stack alone has a different Region. It's separate from the stack with the distribution, and the link between them is the version ARN, passed by hand. CDK also has a construct that links across Regions automatically (`EdgeFunction`). But it adds a custom resource and another stack behind the scenes, and I couldn't fully trace how cdkd handles those. Here I chose the form where everything that gets created is visible.

<<< @/examples/10-edge/infra/lib/body-digest-stack.ts{role}

The logging permission has a `*` for the Region. This book has stuck to "no `*`" so far, but here it can't be avoided. A Lambda@Edge function writes its logs to a Region near where it ran. The log group is named `/aws/lambda/us-east-1.<function name>` in every Region, and which Region it runs in depends on where your readers are. The log group name itself is fixed.

<<< @/examples/10-edge/infra/lib/body-digest-stack.ts{function}

`awsSdkConnectionReuse: false` is easy to miss. Left alone, CDK's `NodejsFunction` adds one environment variable. Lambda@Edge refuses functions that have environment variables, so it's turned off. The tests check that the template has no environment variables, VPC settings, or layers.

On the distribution side, the behavior is added only when a version ARN is given.

<<< @/examples/10-edge/infra/lib/edge-stack.ts{digest}

This behavior has caching off and accepts every method. All it wants is POST, but CloudFront offers three choices, "GET and HEAD", "those plus OPTIONS", and "all", and POST is only in "all". Left like that, a GET or a DELETE would run Lambda@Edge, and be billed for it, on every request.

So the CloudFront Function in front refuses anything but POST.

<<< @/examples/10-edge/infra/functions/edge-router.js{digest}

The three lines at the top of `handler` call this. It answers before reading KVS, so a refusal costs one CloudFront request and one function execution, and nothing else.

POST is not stopped. Every POST that arrives runs Lambda@Edge. Nothing in this setup puts a ceiling on how many (the end of "The money part" comes back to this, with numbers). Once you're done trying it, the surest thing is to deploy again without `-c bodyDigestVersionArn` and take the whole behavior away.

The ARN's shape is checked the moment it's handed to the stack.

<<< @/examples/10-edge/infra/lib/edge-stack.ts{props}

`$LATEST`, an alias, or an ARN in another Region is an error at synth time. You find out far sooner than being turned down by CloudFront halfway through a deploy.

### Deploying it

```bash
AIH_AWS_REGION=us-east-1 vp run infra:bootstrap
vp run edge:body:infra:deploy
vp run edge:infra:deploy -c bodyDigestVersionArn=arn:aws:lambda:us-east-1:123456789012:function:aih-edge-body-digest:1
curl -s -X POST --data 'hello edge' https://dxxxxxxxxxxxx.cloudfront.net/digest
```

The second line prints `BodyDigestVersionArn`, which you pass on the third.

This is the least verified part of the chapter. As far as the cdkd source goes, when a stack names a Region, cdkd uses that Region. The built function code probably needs a place in `us-east-1` too, which is what the first line sets up. But none of it has been run. cdkd handles `AWS::Lambda::Version` through Cloud Control API (`AWS::Lambda::Function`, `AWS::IAM::Role`, and `AWS::IAM::Policy` have dedicated implementations). I also haven't confirmed separately that Node.js 24 works on Lambda@Edge; the documentation only says it "supports the latest versions of Node.js".
