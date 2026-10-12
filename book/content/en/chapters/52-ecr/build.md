---
title: "52 ECR: Design and Build"
---

# 52 ECR: Design and Build

The [previous page](/en/chapters/52-ecr.md) covered the difference between a tag and a digest, and the two repairs that keep the image a task definition names from changing. This page settles the repository's settings one at a time: tags, encryption and policies, then the lifecycle policy, vulnerability scanning, the pull-through cache, replication and pulls from another account, and pushing from CI. It ends with what you can run locally.

## Repository settings

<!-- section: 52.settings -->

<<< @/examples/52-ecr/infra/lib/ecr-stack.ts{repository}

### Tag immutability and its exceptions

The tag setting has four values. Besides `MUTABLE` and `IMMUTABLE` there are two that take exceptions, `IMMUTABLE_WITH_EXCLUSION` and `MUTABLE_WITH_EXCLUSION`. An exception is written as a filter, and there is one kind of filter, `WILDCARD`: a string that may contain `*`, at most five per repository.

`IMMUTABLE_WITH_EXCLUSION` with the filter `latest` gives a repository where no tag can be moved except `latest`. `MUTABLE_WITH_EXCLUSION` with `v*` gives the opposite: any tag can be moved except those that start with `v`. The tests pin this reading down as a function.

<<< @/examples/52-ecr/src/mutability.ts{setting}

The immutability page does not say whether `*` in a filter also matches the empty string. The lifecycle policy pages say that `prod*` matches `prod`, and the same rule is assumed here.

This chapter's repository is `IMMUTABLE`, with no exceptions. Letting `latest` move brings back the breakage of the previous page for `latest`. A tag that moves is usually wanted to mean "the newest one", and that is information the deployment's configuration should hold, not a tag.

Immutability stops a push to a tag that already exists, and nothing else. It does not stop anyone from deleting an image. Whether the same tag can be used again after its image was deleted is not stated in the documentation, and it was not tried. So that it does not matter either way, this chapter's push role is given no permission to delete an image or to change the repository's settings.

### Encryption

With nothing specified, ECR encrypts images with keys that S3 manages (AES-256), at no additional charge. It can use a KMS key instead: the AWS managed key `aws/ecr`, or a customer managed key in the same Region.

The encryption configuration is fixed when the repository is created and cannot be changed afterwards. Changing your mind means creating a new repository and moving the images. This chapter keeps the default. A KMS key costs money (chapter 21), and revoking the grants on the key makes the repository's images impossible to pull. Choose it when you have a clear reason to hold the key yourself.

### Repository policies and the registry policy

ECR has two kinds of policy that attach to the resource.

A repository policy attaches to one repository. By default only the account that created the repository can reach it. Within one account, an action goes through if either an IAM policy or the repository policy allows it, and is refused if either explicitly denies it. This chapter's repository has no repository policy, so IAM policies alone decide who can do what.

The registry policy attaches to the whole registry, one per account per Region. It allows actions at the level of the registry: accepting replication, the pull-through cache, and creating repositories automatically.

One action can be allowed by neither. `ecr:GetAuthorizationToken`, which logs in to the registry, has to be allowed by an IAM policy.

## The lifecycle policy

<!-- section: 52.lifecycle -->

An image left in a repository keeps costing storage. A lifecycle policy is a set of rules that choose images to delete. An image that meets a rule is deleted within 24 hours, and the deletion is recorded in CloudTrail.

One rule pairs a selection with a limit: which images it is about, and how many (or how many days) before they go. The selection is `tagStatus`: `tagged` for images matching tag patterns (`tagPatternList`), `untagged` for images without a tag, `any` for all of them. The limit is counted with `imageCountMoreThan` (counting from the newest, everything past the given number) or `sinceImagePushed` (pushed more than the given number of days ago). There is also `sinceImagePulled`, which counts days since the last pull, and a `transition` action that moves images to archive storage. This chapter uses neither.

The chapter's policy has three rules.

<<< @/examples/52-ecr/src/policy.ts{policy}

The tags follow a fixed scheme. A build is pushed once, under the name of its commit, and a build that goes to production gets a release tag as a second name on the same digest.

<<< @/examples/52-ecr/src/policy.ts{tags}

### The order rules are evaluated in

With several rules, which rule deletes which image is not quite what intuition suggests. Of the documented evaluation rules, three decide the outcome.

- All rules are evaluated at the same time, whatever their priority. They are then applied in order of `rulePriority`, lowest number first
- An image is deleted by one rule at most
- An image that matches a rule's tag requirements cannot be deleted by a rule of lower priority. The lower rule still counts it

The third is the one to remember. In this chapter's policy, an image with a release tag belongs to rule 1, and rule 3 cannot delete it. But when rule 3 counts "the 30 newest", release images are among the 30. If half of the newest 30 are releases, 15 plain builds survive. Reading rule 3 as "keeps 30 images besides the releases" gets the number wrong.

Those rules became this function.

<<< @/examples/52-ecr/src/lifecycle.ts{evaluate}

The evaluator handles the forms this chapter uses and no others: `tagStatus` `tagged` (with `tagPatternList` only), `untagged` and `any`; `countType` `imageCountMoreThan` and `sinceImagePushed`; the action `expire`. It does not handle `tagPrefixList`, `sinceImagePulled`, `transition` or archive storage, and the schema refuses a policy that contains them. It does not handle manifest lists, which bundle several architectures, or reference artifacts such as signatures either. According to the documentation, an image referenced by a manifest list is not deleted before the manifest list.

The tests stand on the six worked examples in "Examples of lifecycle policies". Each gives the contents of a repository, a policy, and the images that are deleted, so the tests copy all three and check that the evaluator arrives at the same result. On top of that they check, for this chapter's policy, that an old release is never deleted for its age, that an untagged image is kept until it is a day old, and that the order in which images are listed does not change the result.

The `*` in a pattern is matched by this function.

<<< @/examples/52-ecr/src/wildcard.ts{wildcard}

### Images that must not be deleted

A rule that keeps a number of images knows nothing about what is running. It knows tags and push times. If production stays on an old build that never got a release tag, rule 3 deletes that image. The running tasks keep running, but when a task is replaced or added, the pull fails and the task does not start.

<<< @/examples/52-ecr/src/lifecycle.ts{in-use}

What protects an image under this chapter's policy is its release tag. The policy rests on an operating agreement: every build that goes to production gets a release tag. The tests check both sides of it. A build left in production without the tag is deleted, and a build of the same age with the tag is kept.

The stack is given the same policy the tests evaluate. It passes through a function that turns it into CDK's rule shape, and a stack test checks that the JSON in the template equals the policy in the tests.

<<< @/examples/52-ecr/infra/lib/ecr-stack.ts{rules}

The local evaluator is not ECR's implementation. The way to find out what will really be deleted is ECR's lifecycle policy preview, which computes and returns the images a policy would delete before the policy is applied. The documentation recommends running a preview first. It was not run for this chapter. There is a task that compares the evaluator's result with the preview after a deploy, described on the [next page](/en/chapters/52-ecr/wrap.md).

## Vulnerability scanning

<!-- section: 52.scan -->

ECR has two kinds of scanning, and a registry uses one or the other.

Basic scanning is done by ECR itself and looks for vulnerabilities in operating system packages. It runs on push, or when you start it by hand. An image can be scanned once in 24 hours, and the scan on push counts as that once. No additional ECR charge for it was found on the pricing page or in the Price List.

Enhanced scanning is done by Amazon Inspector (chapter 21). It covers programming language packages as well as the operating system, which for this book means npm packages. A filter on repositories chooses between scanning on push only and scanning continuously. Under continuous scanning, existing images are scanned again whenever a new vulnerability is published. The charge is Inspector's: in the Tokyo Region, USD 0.11 for the initial scan of an image and USD 0.01 for each re-scan.

The difference between the two is about time. A scan on push finds what was known at that moment. Whether an image pushed three months ago, and still running in production, has a vulnerability that was found last week is something only a new scan can tell. With basic scanning you start that scan by hand. With continuous enhanced scanning, Inspector does.

This chapter's repository sets `imageScanOnPush: true`, which runs basic scanning on push. That is a setting of the repository, and the reference page of the API behind it carries a deprecation notice in favor of configuring scanning at the registry level. The registry setting was not used for the reason given on the previous page: one stack should not hold the setting of every repository in the account. A team that runs a registry should manage the registry's settings in a stack that holds nothing else.

### Where results go

Basic scanning results are read with `DescribeImageScanFindings`. When a scan completes, ECR sends an `ECR Image Scan` event to EventBridge, with a count of findings per severity. The documentation says ECR's events are emitted on a best effort basis, so the absence of an event cannot be taken to mean that the scan has not finished.

Enhanced scanning results can be read through the same API and through Inspector. Inspector sends the EventBridge events: when an initial scan completes, and when a finding is created, updated or closed. Turning events into notifications is covered in [chapter 25](/en/chapters/25-events.md) and [chapter 19](/en/chapters/19-observability.md).

### Stopping a deploy on severity

This function decides whether a scan result stops a deploy.

<<< @/examples/52-ecr/src/scan.ts{decide}

It says yes in one case only: the scan of the digest about to be deployed has finished, and it has nothing at or above the threshold. Everything else is a no. Three decisions about how to say no are built into it.

First, the absence of a result is not treated as the absence of a problem. The scan status can be a failure (`FAILED`), an image the scanner does not support (`UNSUPPORTED_IMAGE`), a daily limit reached (`LIMIT_EXCEEDED`), and so on. Each means that the image was not examined. Letting those through would mean that anything can be deployed exactly on the days scanning is broken.

Second, it checks that the report's digest is the digest of the image being deployed. Looking a result up by tag reads another image's result if the tag moved between the push, the scan and the deploy. The invariant of the previous page shows up here too.

Third, it stops on a finding the scanner could not rate (`UNDEFINED`), so that the unknown is not counted as safe. If that is too noisy for you, change it.

The response is checked with Valibot. A status or a severity name the code does not know is refused by the schema, and the deploy stops.

<<< @/examples/52-ecr/src/scan.ts{report}

The function looks at counts and nothing else. It does not ask whether a fix exists, or whether the vulnerable code can be reached from your application. With the threshold at `HIGH`, one unfixed vulnerability in the base image stops every deploy. Whether a person then decides, or the finding is let through with an expiry date, is for the team to settle. Against a vulnerability found after the push, this function does nothing. That is the job of continuous scanning and notifications.

## The pull-through cache

<!-- section: 52.cache -->

Chapter 12's Dockerfile pulls its base image from Docker Hub. Fetching from an outside registry on every build has two weak points.

One is the limit on pulls. Docker Hub limits unauthenticated pulls to 100 per 6 hours per IPv4 address (or per /64 subnet for IPv6), according to Docker's documentation as of 2026-10-13. CI runners and NAT gateways share one address among many jobs, so you can hit the limit having pulled almost nothing yourself. The other is the route. From a place with no way out, such as chapter 11's private subnets, an outside registry cannot be reached.

A pull-through cache fetches an outside registry's images through your own ECR registry. Once a rule exists, an image can be pulled as `<registry>/<prefix>/<upstream repository>`. On the first pull, ECR fetches the image from the upstream, creates a repository in your registry, and stores a copy. Later pulls return the copy. When a tag is pulled again, ECR checks the upstream for a newer image at most once every 24 hours. If the upstream cannot be reached, the last copy is returned.

Only certain registries can be an upstream. In the documentation as of 2026-10-13, Amazon ECR Public, the Kubernetes registry and Quay need no authentication. Docker Hub, GitHub Container Registry, GitLab Container Registry, Azure Container Registry and Chainguard need credentials stored in a Secrets Manager secret. Another ECR registry can be an upstream as well.

This chapter's rule uses Amazon ECR Public.

<<< @/examples/52-ecr/infra/lib/ecr-stack.ts{cache}

ECR Public was chosen over Docker Hub because it needs no secret. With Docker Hub as the upstream, a Docker Hub access token has to be stored in a secret whose name starts with `ecr-pullthroughcache/`, and a secret has a monthly charge (chapter 21). ECR Public publishes Docker's official images under `docker/library/`, and chapter 12's `node:24-bookworm-slim` exists there as `public.ecr.aws/docker/library/node:24-bookworm-slim` (checked on 2026-10-13 by requesting the manifest without credentials). With the rule in place it can be pulled as `<registry>/ecr-public/docker/library/node:24-bookworm-slim`, according to the documentation. The pull through the cache itself was not tried.

A few things to know before using it.

- The repositories a rule creates are outside the stack. They get default settings: mutable tags and no lifecycle policy. A repository creation template sets them in advance. This chapter creates none
- Making a cache repository's tags immutable stops ECR from updating the copy of a tag. Upstream tags do move, so leave these repositories mutable and name the base image by digest in your own Dockerfile
- The first pull needs `ecr:BatchImportUpstreamImage`, and `ecr:CreateRepository` if the repository does not exist yet
- Even where ECR is reached through interface endpoints, the documentation says the first pull may need a route to the internet. Later pulls do not. For private subnets, pull once from a place that has a route
- Pulling a multi-architecture image by tag stores the manifest list and the image of every architecture it references in the cache. `node:24-bookworm-slim` is such an image
- Lambda cannot use an image pulled through a pull-through cache
- A rule belongs to one Region

## Replication, and pulls from another account

<!-- section: 52.replication -->

Nothing in this section is in the stack. It reports what the documentation says.

There are two main reasons to want an image in another Region or account. One is to be able to start tasks from the same image elsewhere when a Region fails ([chapter 28](/en/chapters/28-multi-region.md)). The other is to separate the account that builds from the account that runs production ([chapter 33](/en/chapters/33-production-readiness.md)).

**Replication** is a registry setting. A rule says "images pushed to this registry are also placed in the registry of that Region (or that account)", narrowed by a prefix of the repository name. Its properties are worth knowing.

- Only images pushed after replication is configured are replicated. Existing images are not
- The repository has the same name at the destination
- Most images replicate within 30 minutes, and in rare cases it takes longer. A deploy in the other Region right after a push may find no image yet
- Replication does not carry deletions. When a lifecycle policy deletes an image in the source repository, the copy stays. Lifecycle policies are not replicated either, so the destination needs its own
- Repository settings such as tag immutability are not replicated by default
- If the destination repository is immutable and already has an image with the same tag, the image is replicated without the tag
- To replicate to another account, the destination account's registry policy allows the source account `ecr:ReplicateImage` and `ecr:CreateRepository`. The source needs no policy

A digest follows from the content, so it is the same at the destination. If the task definition names the image by digest, the only thing that changes with the Region is the registry's host name.

**Pulling from another account** can also be done without replicating. A repository policy allows the other account `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`. In the other account, an IAM policy allows the pulling role the same actions and `ecr:GetAuthorizationToken`. Across accounts, both the resource's side and the other account's IAM side have to allow it.

Replication puts a copy of the image inside the other account. If the source repository disappears, the copy remains. Pulling through a repository policy costs less because it makes no copy, but every pull depends on the source Region and the source account. Replicate to prepare for a Region failure, and use a repository policy when the goal is only to separate accounts.

## Pushing from CI

<!-- section: 52.push -->

In chapter 20 a GitHub Actions workflow assumed a role with an OIDC token and deployed without a long-lived access key stored at GitHub. Images are pushed the same way.

The OIDC provider is the one chapter 20's stack created. An account can hold one provider per issuer, so this stack creates none and refers to it by ARN.

<<< @/examples/52-ecr/infra/lib/ecr-stack.ts{trust}

The trust policy checks the token's `sub` for an exact match. Only a job running on one branch of one repository can assume the role. A pull request from a fork, or a job on another branch, has a different `sub` and cannot. The configuration schema makes sure no `*` gets into the repository or branch name, as in chapter 20.

<<< @/examples/52-ecr/infra/lib/ecr-stack.ts{push}

What the role can do is split into three statements.

`LogIn` is `ecr:GetAuthorizationToken`. The login token is for the registry, and the action cannot name a repository. It is the only place in the stack where the resource is `*`.

`PushToOneRepository` allows the six actions the documentation lists as required to push to a single repository, on this repository's ARN.

`ReadScanResults` reads the digest and the scan result of a pushed image, which the function of the previous section needs when it runs in CI.

What the role is not given matters more. It cannot delete an image, and it cannot change the tag setting, the lifecycle policy or the repository policy. A CI workflow runs a great deal of code, including the install scripts of dependencies. If any of it turned out to be malicious, the most this role allows is adding an image under a new tag. It cannot move an existing tag or turn scanning off. The tests pin the list of allowed actions and check that no deleting or configuring action is among them.

With `-c pullThroughCache=on` there is one more statement, which lets the role pull base images from under the cache's prefix.

The stack is assembled from context.

<<< @/examples/52-ecr/infra/bin/app.ts{context}

### Signing

To let the side that pulls verify that an image was made by your own CI, there is signing. ECR's documentation as of 2026-10-13 describes two methods. With managed signing, a signing configuration on the registry makes ECR create a signature with AWS Signer on every push, and the documentation recommends this one. With manual signing, the pushing side signs using the Notation CLI and the AWS Signer plugin.

A signature is stored in the same repository as a separate artifact attached to the image, a reference artifact. Each one counts as one against the quota of images per repository, and when a lifecycle policy deletes the image, its signatures are deleted within 24 hours. Managed signing requires the pushing role to have `signer:SignPayload` on the signing profile. The Tokyo Region Price List gives USD 0.02 per signature.

A signature means something only when someone verifies it. The settings that keep ECS or Kubernetes from running an unsigned image were not read through, and this chapter does not cover them. That SBOMs and attestations can be stored in the same repository as reference artifacts is as far as the documentation was checked.

## Checking it locally

<!-- section: 52.local -->

The tests, the lifecycle evaluator and the synth of the stack run locally. None of them touches AWS.

```bash
vp test run examples/52-ecr
vp run ecr:lifecycle:preview
vp run ecr:infra:synth
```

`ecr:lifecycle:preview` reads a file shaped like the output of `aws ecr describe-images` and prints the images this chapter's policy would delete. By default it reads `fixtures/describe-images.json`: 46 invented images written for this chapter, not taken from a real repository.

```text
46 images in fixtures/describe-images.json, evaluated at 2026-10-13T00:00:00.000Z
rule 1 (keep the 20 newest releases): expires 2
  sha256:e71e9a100c02  sha-a77516c04d959709a1e1075bf2d0579fe4945161, v1.2.0
  sha256:de8a29219883  sha-12627c4f440671bc8abe7536b4f65b9b887f4bd9, v1.1.0
rule 2 (drop images that lost their tag): expires 1
  sha256:64684731fd88  (untagged)
rule 3 (of everything, keep the 30 newest): expires 8
  sha256:b57f1feb73c6  sha-33509de10444a68c95b3d881d31e55274057a5aa
  sha256:59bdd208f16a  sha-47adfbc5f135f77ee6534ef28a04fbc88adcf1d3
  sha256:11bc0a14f03c  sha-900af6060d18109016b4ab8bdda4eb880562f221
  sha256:9c6fb4a2ecb7  sha-e6c2a943b872bbdb522c498f490c7a4c7573e738
  sha256:1b655cdcf4f7  sha-f37c7c4dd8004944cc2feac467ee6df3f6e80f23
  sha256:1dcefaf50983  sha-599ca3372fce884640ab68536e8ae873bb13ea3c
  sha256:471119cd1cb2  sha-360cdaf89f8676b5f36ab93e04edf82805fce3ee
  sha256:f3af275b0dab  sha-7a886bab3b34adade8e78d1d5467abf10cc5f3a3
kept: 35
```

Of the 46 images, 22 are releases, and rule 1 deletes the two oldest. Of the two images without a tag, rule 2 deletes the one that is more than a day old. Rule 3 keeps the 30 newest. Of the 16 older than that, the 8 releases belong to rule 1 and cannot be deleted, so rule 3 deletes only the 8 that are not releases. 35 images are left, more than the words "keep the 30 newest" suggest.

You can run it on your own repository's listing. Save the output of `aws ecr describe-images` to a file, pass it in, and give the digests running in production with `--in-use`. If one of those images would be deleted, the command fails.

```bash
vp run ecr:lifecycle:preview images.json --in-use sha256:...
```

What is not reproduced locally is ECR itself. Pushing, the refusal to move a tag, scanning, deletion by the lifecycle policy and the pull-through cache were not checked against the real thing. The verification notes on the next page give the breakdown.
