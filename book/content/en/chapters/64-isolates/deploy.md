---
title: "64 Isolates: Deploy"
---

# 64 Isolates: Deploy

## Deploy and check

<!-- section: 64.deploy -->

The steps on this page were never run against AWS. Building the image needs a Docker daemon, which the Nix shell does not include. The steps have the same shape as in [chapter 12](/en/chapters/12-containers/deploy.md), so if you have been through chapter 12, the only difference is what is in the image.

Hourly billing starts partway down this page. First deploy the VPC from chapter 11. In its default layout it costs nothing.

```bash
vp run net:infra:deploy
```

Next, deploy without a tag. Only the repository is created.

```bash
vp run isolates:infra:deploy
```

Prepare the three files that go into the image, then build and push it.

```bash
vp run isolates:fetch
vp run isolates:bundle
vp run isolates:image:build v1
vp run isolates:image:push v1
```

<<< @/examples/64-isolates/src/image.ts{steps}

Before you push, start the image on your machine and check it. This is the check this chapter could not make.

```bash
docker run --rm --read-only -p 8080:8080 -e ALLOWED_ORIGIN=http://localhost:5173 aih-isolates:v1
curl -si http://localhost:8080/health
```

Last, deploy with the tag. **Billing starts with this deploy.**

```bash
vp run isolates:infra:diff -c imageTag=v1
vp run isolates:infra:deploy -c imageTag=v1
vp run isolates:smoke
```

`isolates:smoke` reads the URL from the stack's outputs, calls `/health`, then creates a note, reads it, and deletes it. With one task, the note it created should be readable on the next request.

Raising the workerd version and changing the app follow the same steps. Change the version in `src/release.ts` and in `package.json` together, build an image under a new tag, and deploy with that tag.

```bash
vp run isolates:image:build v2
vp run isolates:image:push v2
vp run isolates:infra:deploy -c imageTag=v2
```

`-c` lasts for that one command only. A deploy without `-c imageTag=...` deletes the load balancer and the task. Give `diff` the same `-c` and look at the changes first.

Drift detection is the same as in chapter 02.

```bash
vp run isolates:infra:drift
```

The points chapter 12's deploy page lists as unverified apply to this chapter unchanged: reading the VPC through `Fn::ImportValue` from a stack in another app, and what cdkd reports when the circuit breaker rolls back.
