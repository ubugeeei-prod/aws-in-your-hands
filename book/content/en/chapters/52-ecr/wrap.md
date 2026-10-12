---
title: "52 ECR: Costs, Pitfalls, and Cleanup"
---

# 52 ECR: Costs, Pitfalls, and Cleanup

The [previous page](/en/chapters/52-ecr/build.md) settled the repository's settings and wrote the functions behind them. This page gathers the steps to deploy and check, the prices, the pitfalls, what to change for production, and the cleanup. The deploy steps were prepared and not run.

## Deploy and check

<!-- section: 52.deploy -->

For the repository alone, deploy with no context. It costs nothing.

```bash
vp run ecr:infra:diff
vp run ecr:infra:deploy
```

To create the role CI pushes with, pass the GitHub repository. GitHub's OIDC provider has to exist in the account first, created by the CI stack of [chapter 20](/en/chapters/20-shipping.md). Without the provider the role cannot be assumed. Whether creating the role succeeds at all without the provider was not checked.

```bash
vp run ecr:infra:deploy -c githubRepository=owner/repo -c pullThroughCache=on
```

There are three outputs: `RepositoryUri`, `RepositoryName` and `PushRoleArn`.

Build and push an image with chapter 12's tasks. This is the step that needs a Docker daemon. Given `--repository-uri`, chapter 12's push task pushes to that repository instead of chapter 12's own.

```bash
vp run ecs:bundle
vp run ecs:image:build sha-0123abc
vp run ecs:image:push sha-0123abc --repository-uri <RepositoryUri>
```

Then try pushing a different image under the same tag. An immutable repository should refuse it with `ImageTagAlreadyExistsException`.

Ask the repository for the digest of what you pushed.

```bash
aws ecr describe-images --region ap-northeast-1 \
  --repository-name <RepositoryName> \
  --image-ids imageTag=sha-0123abc \
  --query 'imageDetails[0].imageDigest' --output text
```

The next task decides whether the scan result stops a deploy. It waits for the scan, polling every 5 seconds up to 60 times, and exits non-zero if there is a finding at or above the threshold (`HIGH` by default) or if the scan does not finish. It waits for the status `COMPLETE`, so it is for basic scanning. Under continuous enhanced scanning the status is `ACTIVE`.

```bash
vp run ecr:scan:gate --digest sha256:...
```

Once a few images have piled up, have ECR evaluate the lifecycle policy and compare its answer with this chapter's evaluator. The task starts ECR's lifecycle policy preview, waits for it, and matches the images due to be deleted, and the rule numbers, against the local result. A preview only reports. It deletes nothing.

```bash
vp run ecr:lifecycle:compare
```

If the two disagree, ECR is the one that is right. Fix the evaluator and add that input to the tests.

In CI, a workflow assumes the `PushRoleArn` role the way chapter 20 does, then logs in and pushes with chapter 12's steps. This chapter ships no workflow file. The push role cannot read cdkd's state, so give `ecr:scan:gate` the repository's name with `--repository-name`.

Drift detection tells you whether a setting was changed by hand. A tag setting turned back to `MUTABLE` is found here.

```bash
vp run ecr:infra:drift
```

## Prices

<!-- section: 52.cost -->

The unit prices are for the Tokyo Region, read from the AWS Price List bulk API on 2026-10-13.

ECR charges for two things, storage and data transfer. Storage is USD 0.10 per GB a month; the number of repositories, pushes and pulls is not charged. Data transferred in, which is what a push is, is free, and so is a pull from Fargate, Lambda or EC2 in the same Region, at USD 0.00 per GB. What costs money is transfer that leaves the Region. Pulling an image from outside AWS, from a GitHub runner for instance, is data transfer out to the internet at USD 0.114 per GB for the first 10 TB.

The amounts below assume 0.15 GB per image. No image was built, so that size is not a measurement. How layers shared between images count toward storage was not confirmed either, so every image is counted in full.

| State | Assumption | Per month |
| --- | --- | --- |
| The stack, deployed | no image | USD 0.00 |
| As full as the policy lets it get | 50 images, 7.5 GB | USD 0.75 |
| A year without a policy | 5 pushes each working day, 1,200 images, 180 GB | USD 18.00 |

The third row is one month at the end of that year, and with nothing done the next month is larger. The sum looks small, but the cost of images nobody deletes grows until someone stops it, and the more images there are, the less anyone knows which can go. A lifecycle policy belongs in the same change that creates the repository.

The options are priced as follows.

- Enhanced scanning: Inspector's charge, USD 0.11 for the initial scan of an image and USD 0.01 per re-scan. Assuming 100 pushes a month and four re-scans a month of each of the 50 images kept, USD 13.00 a month. How often a re-scan happens depends on new vulnerabilities being published, and the number four has no basis. No price was found for basic scanning
- Replication: the source Region's inter-Region data transfer rate. Replicating 100 images (15 GB) a month to Osaka is USD 1.35 a month. Storage at the destination is charged on top; the Osaka price was not checked
- Pull-through cache: no price was found for the rule itself. The copies are stored in your own repositories and charged as storage. A secret, needed for upstreams such as Docker Hub, is USD 0.40 a month each (chapter 21)
- Signing: managed signing is USD 0.02 per signature
- Archive: in the Tokyo Region, archive storage is also USD 0.10 per GB a month up to 153,600 GB, the same price as standard storage. Retrieval is USD 0.03 per GB, and at least 90 days of storage are billed. At this book's scale, archiving saves nothing

No free allowance is deducted. The pricing page gives new customers 500 MB of private repository storage for one year, which does not apply to every account. Inspector has a trial for new accounts, which is not a monthly allowance.

After the stack is destroyed the cost is USD 0. The repositories a pull-through cache created are outside the stack, though, and keep costing storage until they are deleted.

## Pitfalls

<!-- section: 52.pitfalls -->

**The policy is in place and no image disappears.** A lifecycle policy deletes within 24 hours of an image meeting a rule, not at once. The opposite happens too: a policy that deletes a great many images soon after it is applied. That is why you preview first.

**`v*` matches a tag you did not mean.** `v*` matches `v1.2.0` and also `vendor-test`. Under this chapter's policy such an image counts as a release and pushes a real release out of the 20. The policy assumes that once the tag scheme is fixed, nobody tags any other way.

**The rule for untagged images deletes an image that is in use.** If you push single-architecture images, as chapter 12 does, an image without a tag is one that lost its tag. In a multi-architecture image, the per-architecture images carry no tag and are referenced by the manifest list. According to the documentation, a referenced image is not deleted before its manifest list. This chapter's evaluator does not implement that rule, so on such a repository the local result lists more than ECR would delete.

**No scan result is found.** Calling `DescribeImageScanFindings` for an image that was never scanned returns `ScanNotFoundException`. An image pushed before scan on push was turned on is such a case. In a registry with enhanced scanning on, a repository that matches no filter is not scanned, and manual scans are not possible.

**Switching between basic and enhanced hides the earlier results.** The documentation says the previously established scans are no longer available after a switch. Switching back makes them available again.

**The first pull through the cache fails.** The pulling role may lack `ecr:BatchImportUpstreamImage` and `ecr:CreateRepository`, or the first pull may come from a place with no route to the internet.

**Login fails.** `ecr:GetAuthorizationToken` cannot be allowed by a repository policy. Allow it in an IAM policy, on `*`.

## For production

<!-- section: 52.production -->

- **Keep the repository.** For practice it has `RemovalPolicy.DESTROY` and `emptyOnDelete: true`. In production use `RETAIN` and drop `emptyOnDelete`. A setting under which deleting a stack deletes the images that are running is dangerous
- **Name the image by digest in the task definition.** Record the digest of every release and pass that value to the deployment. A rollback is passing the previous digest again
- **Give the lifecycle check the digests running in production.** That is what `--in-use` on `ecr:lifecycle:preview` is for. Run it against the real image listing in the CI of any pull request that changes the policy
- **Configure scanning on the registry, and keep scanning after the push.** Put repositories that run in production under continuous enhanced scanning and connect Inspector's events to notifications. The decision at push time guards the door once
- **Separate the account that builds from the account that runs.** The production account receives images by replication or through a repository policy, and can be set so that nobody pushes to it
- **Decide the settings of the repositories the cache creates.** Use a repository creation template to give them a lifecycle policy. Without one, old copies of base images pile up
- **Know the quotas.** A repository holds 100,000 images (adjustable), `PutImage` is limited to 10 requests a second per Region (adjustable), and a lifecycle policy has at most 50 rules, as of 2026-10-13. [Chapter 32](/en/chapters/32-limits.md) shows how to look limits up

## Cleanup

<!-- section: 52.cleanup -->

```bash
vp run ecr:infra:destroy
```

The repository goes together with its images, because of `emptyOnDelete: true`. The pinned cdkd deletes a repository that holds images only when that setting is present.

Three things remain after the stack is destroyed.

The first is any repository the pull-through cache created. Look for repositories whose names start with `ecr-public/` and delete them.

```bash
aws ecr describe-repositories --region ap-northeast-1 \
  --query 'repositories[].repositoryName'
aws ecr delete-repository --region ap-northeast-1 \
  --repository-name ecr-public/docker/library/node --force
```

The second is the service-linked role ECR creates automatically when a pull-through cache rule is created. It costs nothing.

The third is chapter 20's OIDC provider, and the storage created by cdkd's bootstrap. Neither belongs to this chapter. To remove them, follow their own chapters.

## As a distributed system

<!-- section: 52.distributed -->

- Who owns the state: the repository owns "which image is this tag". The task definition owns "what to run", and an ECS service holds the digests it resolved at each deployment. The three change independently, so as long as you point by name, the result depends on which moment's answer you are using
- Invariant: the image a task definition names is the image that runs
- Tests that try to break it: moving a tag between two pulls, rolling back after a tag moved, and deleting the named image and then reusing its tag, each reproduced in a fixed order on the model of a repository
- What a digest does not guarantee: a digest guarantees that nothing else runs. It does not guarantee that the image still exists. A lifecycle policy deletes images without knowing about task definitions. The only thing connecting the two is the operating agreement to tag releases
- Delays: replication mostly finishes within 30 minutes, with no stated upper bound. A copy in the pull-through cache can be up to 24 hours behind its upstream. Deletion by a lifecycle policy happens within 24 hours. All of these are guarantees of the "eventually" kind
- The moment of a scan: a scan on push is an answer against the vulnerability database of that moment. The image does not change, and the answer still goes stale
- Notices that may not arrive: ECR's events are best effort. If a push or scan event starts the next step, have another way to notice when the event never came

::: details Verification notes for this chapter

**Checked locally.** 60 unit tests (writing and reading references, wildcards, the four values of the tag setting, the two ways a moved tag breaks the invariant and the two repairs, the documentation's six examples reproduced, this chapter's policy, policies the schema refuses, the deploy decision, reading `describe-images`, the comparison with a preview, and the stack's assertions). The type check. The output of `ecr:lifecycle:preview`. `ecr:infra:synth`: the templates of the default layout, and of the layout with `-c githubRepository=example/notes -c pullThroughCache=on`, are synthesized without asking AWS anything. `vp check --fix` on this chapter's files, with no warnings, awscdk-lint included. That `public.ecr.aws/docker/library/node:24-bookworm-slim` exists (an anonymous request for the manifest; no AWS credentials were used).

**Not checked yet.** Nothing was run on AWS. No image was built or pushed. In particular, the following was only read in the documentation.

- The evaluation of the lifecycle policy. `src/lifecycle.ts` is written from the documented evaluation rules and six examples, and was not compared with ECR's preview. The boundary of "older than N days" and the order of images pushed at the same instant are not stated in the documentation. Example B under "all images" deletes one of two images that are both "1 day" old, and the test places the one that survives slightly later
- The assumptions of the repository model. That moving a tag leaves the earlier image without a tag, that a second tag can be added to the same digest, and that deleting an image frees its tag are assumptions of `src/registry.ts`, not checked against the real thing
- Whether `*` in a tag mutability exclusion filter matches the empty string
- That an immutable repository refuses a second push of a tag with `ImageTagAlreadyExistsException`
- Scanning: that scan on push runs, the shape of `findingSeverityCounts` when there are no findings, how long a scan takes, and whether chapter 12's base image is an operating system basic scanning supports
- Whether a rollback by the ECS circuit breaker reuses the digests resolved earlier or resolves the tag again
- Deploying with cdkd, in particular that `AWS::ECR::PullThroughCacheRule` can be created through the Cloud Control API
- Assuming the push role from GitHub Actions and pushing with it. Whether creating the role succeeds in an account without the OIDC provider
- A pull through the cache, and the repository it creates
- Replication, pulls from another account, and signing. They are not in the stack; only the documentation was read. The settings on the verifying side of signing were not read through
- The assumptions behind the prices. The size of an image, the number of pushes and the number of re-scans were not measured. How shared layers are counted was not confirmed
- Whether Cloudflare's registry has settings comparable to lifecycle policies or scanning

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| A tag is a name, a digest is the content | `examples/52-ecr/src/reference.ts`, `src/registry.ts`, `test/invariant.test.ts` | `test:unit` |
| Repository settings | `examples/52-ecr/infra/lib/ecr-stack.ts`, `src/mutability.ts`, `test/mutability.test.ts` | `test:unit` |
| The lifecycle policy | `examples/52-ecr/src/lifecycle.ts`, `src/policy.ts`, `src/wildcard.ts`, `test/lifecycle.test.ts` | `test:unit`, `ecr:lifecycle:preview` |
| Vulnerability scanning | `examples/52-ecr/src/scan.ts`, `test/scan.test.ts`, `scripts/scan-gate.ts` | `test:unit`, `ecr:scan:gate` |
| The pull-through cache | `examples/52-ecr/infra/lib/ecr-stack.ts`, `src/config.ts` | `test:unit` |
| Pushing from CI | `examples/52-ecr/infra/lib/ecr-stack.ts`, `infra/bin/app.ts`, `infra/test/ecr-stack.test.ts` | `test:unit`, `ecr:infra:synth` |
| Checking it locally | `examples/52-ecr/scripts/lifecycle-preview.ts`, `src/describe.ts`, `fixtures/`, `test/describe.test.ts` | `ecr:lifecycle:preview` |
| Deploy and check | `examples/52-ecr/scripts/lifecycle-compare.ts`, `scripts/scan-gate.ts` | `ecr:infra:diff`, `ecr:infra:deploy`, `ecr:lifecycle:compare`, `ecr:scan:gate`, `ecr:infra:drift` |
| Prices | `data/pricing/` | |
| Cleanup | `tools/src/infra/` | `ecr:infra:destroy` |

**How cdkd (0.296.28) handles the types.** The `dist/` of the installed npm package was read. `AWS::ECR::Repository` and `AWS::IAM::Role` have providers of their own, and the ECR provider handles the tag setting and its exclusion filters, the scanning configuration, the lifecycle policy and `EmptyOnDelete`. `AWS::ECR::PullThroughCacheRule` appears nowhere in the package: it has no provider and is not on the list of unsupported types. By the reading chapter 12 established, it goes through the Cloud Control API.

**Primary sources** (all checked on 2026-10-13)

- Tags, encryption and policies: [Preventing image tags from being overwritten](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html), [PutImageTagMutability](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_PutImageTagMutability.html), [ImageTagMutabilityExclusionFilter](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_ImageTagMutabilityExclusionFilter.html), [Encryption at rest](https://docs.aws.amazon.com/AmazonECR/latest/userguide/encryption-at-rest.html), [Private repository policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policies.html), [Private repository policy examples](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.html), [Private registry permissions](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry-permissions.html)
- Lifecycle: [Automate the cleanup of images by using lifecycle policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html), [Lifecycle policy properties](https://docs.aws.amazon.com/AmazonECR/latest/userguide/lifecycle_policy_parameters.html), [Examples of lifecycle policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/lifecycle_policy_examples.html), [Creating a lifecycle policy preview](https://docs.aws.amazon.com/AmazonECR/latest/userguide/lpp_creation.html)
- Scanning: [Scan images for software vulnerabilities](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html), [basic scanning](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning-basic.html), [enhanced scanning](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning-enhanced.html), [DescribeImageScanFindings](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_DescribeImageScanFindings.html), [ImageScanStatus](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_ImageScanStatus.html), [PutImageScanningConfiguration](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_PutImageScanningConfiguration.html), [Amazon ECR events and EventBridge](https://docs.aws.amazon.com/AmazonECR/latest/userguide/ecr-eventbridge.html)
- Pull-through cache and replication: [Sync an upstream registry with an Amazon ECR private registry](https://docs.aws.amazon.com/AmazonECR/latest/userguide/pull-through-cache.html), [Creating a pull through cache rule](https://docs.aws.amazon.com/AmazonECR/latest/userguide/pull-through-cache-creating-rule.html), [IAM permissions required](https://docs.aws.amazon.com/AmazonECR/latest/userguide/pull-through-cache-iam.html), [Private image replication](https://docs.aws.amazon.com/AmazonECR/latest/userguide/replication.html), [Docker Hub pull usage and limits](https://docs.docker.com/docker-hub/usage/pulls/), [the manifest on ECR Public](https://public.ecr.aws/v2/docker/library/node/manifests/24-bookworm-slim) (requested with a token)
- Pushing and signing: [IAM permissions for pushing an image](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html), [Sign images in Amazon ECR](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-signing.html), [Managed signing](https://docs.aws.amazon.com/AmazonECR/latest/userguide/managed-signing.html)
- ECS: [Deploy Amazon ECS services by replacing tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html) (the section on container image resolution)
- Quotas and prices: [Amazon ECR service quotas](https://docs.aws.amazon.com/AmazonECR/latest/userguide/service-quotas.html), [Amazon ECR pricing](https://aws.amazon.com/ecr/pricing/) (read as text, so the rate tables could not be read)
- AWS Price List bulk API: [ECR](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECR/current/ap-northeast-1/index.json), [Inspector](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonInspectorV2/current/ap-northeast-1/index.json) (the data transfer and Secrets Manager prices are the ones other chapters confirmed)
- The ECR service model shipped in AWS CLI 2.35.11 ([service-2.json](https://github.com/aws/aws-cli/blob/2.35.11/awscli/botocore/data/ecr/2015-09-21/service-2.json) and waiters-2.json), read from the copy in the Nix shell. The shape of the lifecycle policy preview API, the scan status and severity values, and the waiters' interval and attempts come from it
- Pinned packages: aws-cdk-lib 2.273.0 (types and code of `aws-ecr` and `aws-ecs`), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)
- Cloudflare: [Containers: image management](https://developers.cloudflare.com/containers/platform-details/image-management/)

:::
