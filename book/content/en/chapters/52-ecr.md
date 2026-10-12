---
title: "52 ECR: Tags and Digests, Lifecycle, Scanning, Replication, and Pull-Through Cache"
sourceRevision: 1
---

# 52 ECR: Tags and Digests, Lifecycle, Scanning, Replication, and Pull-Through Cache

An image tag is a name, and a digest is the content. A name can be pointed at other content later; a digest is computed from the content and cannot. Every setting in this chapter follows from that difference: whether a deployment points at a name or at content, how to decide which images may be deleted, and which image a scan result belongs to.

[Chapter 12](/en/chapters/12-containers.md) created one repository and pushed one image by hand. It made tags immutable, added a rule that keeps the ten newest images, and stopped there. This chapter picks up from that point and goes through what you have to decide once CI pushes images every day. Besides chapter 12 it builds on [chapter 20](/en/chapters/20-shipping.md), where GitHub Actions entered AWS through OIDC, and [chapter 21](/en/chapters/21-security.md), which introduced Inspector. The code is in `examples/52-ecr/`.

The price first: with no image in it, this chapter's stack costs USD 0. ECR charges for what is stored, USD 0.10 per GB a month in the Tokyo Region. Nothing here is billed by the hour.

The Nix shell has no Docker daemon, so no image was built or pushed for this chapter. What ran locally is the tests of the functions that make the decisions, and the synth of the stack. Everything said about how ECR behaves was read in its documentation.

## The whole picture

<!-- section: 52.overview -->

```figure
caption: CI assumes the role from one branch only and pushes to one repository. The task definition names its image by digest
node ci: GitHub Actions | main branch
node role: Push role | OIDC, 1 hour
node public: Amazon ECR Public
node cache: pull-through cache | ecr-public/*
node repo: ECR repository | immutable, scan on push, lifecycle
node task: ECS task definition | image: repository@sha256:...
edge ci -> role: AssumeRoleWithWebIdentity
edge role -> repo: PutImage
edge public --> cache: copied on first pull
edge cache -> ci: base image
edge repo -> task: pulled by digest
group aws: AWS account = role, cache, repo, task
mark repo
```

The stack holds three things: the repository, the role CI uses to push, and a pull-through cache rule with Amazon ECR Public as its upstream. The role exists only when you pass `-c githubRepository=owner/repo`, and the rule only with `-c pullThroughCache=on`. With no context at all, the stack is one repository.

The repository has three settings. It refuses to move any tag, without exception; it scans every image for vulnerabilities when it is pushed; and it has a lifecycle policy that deletes old images. A lifecycle policy that deletes an image it should have kept is easy to write, so the chapter includes a small evaluator that runs the policy locally, where tests can check it.

Replication across Regions, pulls from another account, and signing are not in the stack. Replication and signing are settings of the whole registry, and a stack that owned them would change every other repository in the account. The [next page](/en/chapters/52-ecr/build.md) explains them from the documentation.

## A tag is a name, a digest is the content

<!-- section: 52.digest -->

There are two ways to name an image. `repository:v1.2.0` is a tag, and `repository@sha256:...` is a digest. The digest is the SHA-256 of the image's manifest. The manifest lists the digests of the layers, so one changed byte anywhere changes the digest.

<<< @/examples/52-ecr/src/reference.ts{reference}

A tag is only a row in a table inside the repository: "`prod` points at `sha256:aaa...`". Pushing another image under the same tag rewrites the row. The earlier image is not deleted. It stays in the repository as an image without a tag.

The invariant of this chapter is that **the image a task definition names is the image that runs**. When the task definition names a tag and the tag moves, the invariant breaks in two ways.

```figure
type: sequence
caption: The task definition was never edited, and the rollback still runs the broken image
actor ci: CI
actor repo: Repository
actor ecs: ECS
step ci -> repo: push prod = aaa
step ecs -> repo: deploy revision 1, pull prod
note repo: prod is aaa
step ci -> repo: push prod = bbb
note repo: prod is bbb, aaa has no tag
step ecs -> repo: deploy revision 2, pull prod
note ecs: bbb runs, and is broken
step ecs -> repo: roll back to revision 1, pull prod
note ecs: what runs is bbb
```

The first way: two tasks started from the same task definition run different images. Which image a tag points at is decided when the image is pulled, so a tag that moves between two pulls gives two answers. The second way is the one in the figure, and it takes the rollback away. Revision 1 and revision 2 are the same string, `repository:prod`. Going back to revision 1 changes nothing, because `prod` already points at the broken image. The image that worked is still in the repository, but it has lost its name, and unless someone wrote its digest down there is no way to find it.

The tests reproduce both, in a fixed order, on a small model of a repository.

<<< @/examples/52-ecr/src/registry.ts{registry}

The model is this book's reading of the documentation, not ECR. It knows tags, digests, and the setting that says whether a tag may move.

There are two repairs, and the chapter uses both. One is on the repository's side: make tags immutable. A push of another image under a tag that already exists is answered with `ImageTagAlreadyExistsException`. The other is on the side that points: write the digest in the task definition. An image named by digest is the same image however the tags move. If that image has been deleted, the task fails to start rather than start something else, and a failure is noticed where a silent substitution is not.

ECS takes on part of the problem itself. According to its documentation, an ECS service by default resolves the tags in a task definition to digests when it deploys. The first task started in a deployment establishes the digests, and the service's other tasks start from those digests. Inside a service, then, the first kind of break, where only the task added by a scale-out runs another image, has become unlikely. But the resolution happens per deployment. The documentation says that forcing a new deployment establishes updated digests. Deploying an older revision is a deployment too, so a moved tag would be resolved again at that point. Whether an automatic rollback by the circuit breaker reuses the digests resolved earlier was not confirmed.

You learn the digest by asking the repository after the push. The response of `aws ecr describe-images` has `imageDigest`, and the event ECR sends to EventBridge when a push completes carries `image-digest`. In CDK, passing a string that starts with `sha256:` as the second argument, as in `ecs.ContainerImage.fromEcrRepository(repository, "sha256:...")`, produces the form joined with `@`. This was checked in the code of the pinned aws-cdk-lib (2.273.0).

Chapter 12's stack accepts only `-c imageTag`; it cannot be given a digest. In an immutable repository where few people can delete images, a tag settles on one image as well. The digest is still the better habit, because it does not depend on a setting. Someone can change a repository's settings later.

## When you do not need this chapter

If one person pushes images by hand, as in chapter 12, with immutable tags and one rule that deletes old images, there is little more to decide about ECR. The settings here start to matter when CI pushes daily, several people deploy, and you need the configuration to say which image is running in production.

If you hand images to CDK with `ecs.ContainerImage.fromAsset`, CDK and cdkd choose the repository and the tag (chapter 12). You do not own a repository, so most of this chapter has nothing to act on.

On Cloudflare Containers, images live in a registry Cloudflare manages (`registry.cloudflare.com`), and `wrangler deploy` builds and pushes them. It can also be set to pull images from Docker Hub or Amazon ECR. That much was confirmed in Cloudflare's documentation as of 2026-10-13. Whether that registry has settings comparable to lifecycle policies or scanning was not looked into. The deployment tool takes care of the registry, so the user has fewer things to decide.
