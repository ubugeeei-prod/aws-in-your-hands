---
title: "69 Web Functions: Deploy"
---

# 69 Web Functions: Deploy

By the end of [Run It Locally](/en/chapters/69-web-functions/local.md) the server and the package were checked. This page puts the stack on AWS, checks it with signed requests, and moves traffic to a new revision a little at a time. **None of the steps on this page were run.** The tasks and the tests of what is inside them are prepared, and no result from AWS is written here.

## Why CloudFormation and not cdkd

<!-- section: 69.tool -->

The stacks in this book have been deployed with cdkd. This one stack uses the AWS CDK CLI and CloudFormation, as [chapter 20](/en/chapters/20-shipping.md) does. Four things were checked on 2026-10-13.

- The pinned `aws-cdk-lib` 2.273.0 has three L1 constructs: `lambda.CfnWebFunction`, `lambda.CfnWebFunctionRevision`, and `lambda.CfnWebFunctionEndpoint`. No L2 construct was found
- The CloudFormation template reference has pages for `AWS::Lambda::WebFunction`, `AWS::Lambda::WebFunctionRevision`, and `AWS::Lambda::WebFunctionEndpoint`
- `src/provisioning/register-providers.ts` of cdkd 0.296.28 has no provider for the three types. cdkd leaves types without a provider to the Cloud Control API, and the list of resources the Cloud Control API supports did not have the three either
- The pinned `@aws-sdk/client-lambda-web` 3.1149.0 has one operation, `GetWebAccountSettings`. The operation that creates a revision arrived in 3.1150.0, published on the day of the announcement

So among the tools this book pins, only CloudFormation can create a Web Function. cdkd could create the bucket, the role, and the log groups, but one stack is not managed by two tools. Once cdkd supports Web Functions, this stack goes back to cdkd.

The tasks begin with `webfn:cfn:`, and one function builds the arguments for the CLI.

<<< @/examples/69-web-functions/src/cdk-args.ts{invocation}

`deploy` has one check that only this chapter needs. Which upload runs is passed as `-c stable=<version ID>`, and `-c` holds for that one run. A deploy that forgets it produces a template with no revision and no endpoint, and CloudFormation then deletes the real ones. The domain name of a deleted endpoint is never assigned again. So a deploy without `-c stable` goes through only when it says `--foundation` in so many words.

<<< @/examples/69-web-functions/test/cdk-args.test.ts{foundation}

## The first deploy

<!-- section: 69.deploy -->

You need the account set up as in [chapter 01](/en/chapters/01-account.md), and `AIH_AWS_ACCOUNT_ID` in `.env`. Because CloudFormation is used, chapter 20's bootstrap is needed as well. If it has not been done, run it once.

```bash
vp run ship:cfn:bootstrap
```

The deploy has three stages. A revision points at a version of an S3 object, so the bucket comes first, then the package, and then a second deploy that is given the version ID.

```bash
vp run webfn:cfn:deploy --foundation
vp run webfn:upload
vp run webfn:cfn:diff -c stable=<version>
vp run webfn:cfn:deploy -c stable=<version>
```

The first line creates the bucket, the bucket policy, the execution role, the two log groups, and a Web Function that is only a name. Nothing can receive a request yet.

The second line builds the package, puts it in the bucket, and prints the version ID S3 returned and a checksum. That ID goes where `<version>` is.

The fourth line creates the revision and the endpoint. CloudFormation should wait for the revision to become Active before it creates the endpoint. The stack output `EndpointUrl` is the endpoint's URL. The CLI also writes the outputs to `examples/69-web-functions/reports/webfn-outputs.json`.

A revision and an endpoint that are Active do not mean the server has started. To find out, send requests.

```bash
vp run webfn:smoke
```

The endpoint is `IamAuth`, so requests need a SigV4 signature. The service name is `lambda`. One thing differs from ordinary AWS APIs: a request with no body carries an `x-amz-content-sha256` header too. Lambda does not read the body when it checks the signature, and uses the value of this header as the body's hash.

<<< @/examples/69-web-functions/src/sign.ts{sign}

`webfn:smoke` checks, in this order, that an unsigned request is refused, that a signed `GET /health` is answered, and that a note can be created, read, and deleted. Then it sends `GET /health` 20 times and counts the answers by the `x-aih-release` of the response. With one revision, all 20 should carry the same value.

When something goes wrong, read the status and the headers of the response. A 403 is the signature or the permissions. A 502 with `lambda-web-error-type` set to `Application.TimeoutListenError` means the server never started listening, and the error from the start is in the log group `/aih/web-notes.local`. A 409 means the revision or the endpoint is not Active.

## Moving to a new revision

<!-- section: 69.rollout -->

After a change to the code, upload again. The key is the same, so the bucket gets a new version, and the version the old revision points at stays where it is.

```bash
vp run webfn:upload
vp run webfn:cfn:deploy -c stable=<v1> -c canary=<v2> -c canaryWeight=10
vp run webfn:smoke --count 100
```

The three `-c` values are checked against one schema and then turned into weights. An endpoint accepts weights that are whole numbers from 1 to 100 and add up to exactly 100, for at most two revisions.

<<< @/examples/69-web-functions/src/release.ts{release}

<<< @/examples/69-web-functions/src/release.ts{weights}

The stack creates a revision as a separate resource for each upload. In CloudFormation, changing a revision's properties replaces it, and the old one is deleted. Running two revisions at once means adding the new revision next to the old one without touching the old one's resource. That is why the logical ID is made from the version ID.

<<< @/examples/69-web-functions/infra/test/web-functions-stack.test.ts{two-revisions}

You watch the canary in the output of `webfn:smoke --count 100` and in the `release` field of the logs. The metric `HTTPResponseStatusClass5XX` has no dimension for the revision, so when 5xx responses go up, the metrics cannot say which revision returned them. The in-memory notes are separate in each execution environment, so while two revisions share the traffic, a note you created is unreadable more often.

If all is well, make the new upload `stable`. If not, deploy again without the `canary`.

```bash
vp run webfn:cfn:deploy -c stable=<v2>
vp run webfn:cfn:deploy -c stable=<v1>
```

The first line promotes. The second rolls back during the canary, and it is nothing more than deploying with the arguments from before the canary was added.

<<< @/examples/69-web-functions/test/release.test.ts{canary}

[Chapter 31](/en/chapters/31-progressive-delivery.md) wrote its own script to move an alias's weights, down to watching an alarm and going back. In a Web Function the weights are a property of the endpoint, and splitting between two revisions is built in. But the steps in this chapter lack two things chapter 31 had.

One is going back automatically. A person runs each deploy that moves the weights forward or back. No mention of Web Functions together with CodeDeploy was found in the documentation.

The other is the place to go back to. On promotion the old revision leaves the template, and CloudFormation deletes the real one. Going back to `-c stable=<v1>` after that creates a new revision from the same object version. Unlike moving an alias's weights back, this takes the time the revision needs to become Active, and then the start of new execution environments. To be able to go back right after a promotion, you can leave the old revision a weight of 1, as in `-c stable=<v2> -c canary=<v1> -c canaryWeight=1`.

A change of weights is an asynchronous update of the endpoint. Calling the API directly, you would wait for `updateStatus` to become `Successful`. Whether CloudFormation waits that long before it calls the deploy complete was not confirmed. If the shares in `webfn:smoke` right after a deploy are not what you expect, wait a little and run it again.

A change to configuration with the same upload, such as adding `-c allowedOrigin=...`, replaces the revision under the same logical ID. All requests move to the new revision at once, and there is no canary.

The next page, [Costs, Pitfalls, and Cleanup](/en/chapters/69-web-functions/wrap.md), covers what it costs and how to remove it.
