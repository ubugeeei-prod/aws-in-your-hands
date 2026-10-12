---
title: "03 Static Hosting: Deploy"
---

# 03 Static Hosting: Deploy

## Deploy

<!-- section: 03.deploy -->

This section assumes that `.env` is set up and `vp run infra:bootstrap` was done in chapter 02.

```bash
vp run spa:infra:diff
vp run spa:infra:deploy
```

After the API responds to creating a distribution, propagation to edge locations around the world continues. This book's deploy task passes `--full-wait` to cdkd and waits until propagation finishes. How long that takes has not been measured.

When it finishes, `DistributionDomainName` shows a domain name of the form `dxxxxxxxxxxxx.cloudfront.net`. At this point the bucket is empty. Opening the URL shows nothing.

To be honest, the tasks from here on that touch AWS have not been run against a real account yet. The details are in the notes at the end of the chapter.

### Creating infrastructure and publishing content are separate jobs

This is where the experience differs from Cloudflare Pages or Vercel.

- Creating or changing infrastructure is `spa:infra:deploy`. It changes the bucket, the distribution, and the function, and you do it rarely
- Publishing content is `spa:publish`. It changes objects in the bucket, and you do it on every change

Running `spa:infra:deploy` does not publish a new version of the app. In the other direction, `spa:publish` does not touch the settings of the bucket or the distribution. Keeping them apart lets you update content alone and quickly, and leaves cdkd as the only thing that manages the infrastructure.

## Publish

<!-- section: 03.publish -->

```bash
vp run spa:publish:plan
vp run spa:publish
```

`spa:publish:plan` only shows what would be uploaded and what would be deleted; it changes nothing. `spa:publish` is the one that carries it out. Both run `vp run build:spa` first.

Publishing is split into a part that decides what to do and a part that does it. The first is a pure function, so it can be tested without AWS.

### Cache policy

<<< @/tools/src/site/plan.ts{cache}

Vite puts a hash of the contents into the names of the files under `assets/`. When the contents change the name changes, so the contents at a given URL never change. That is why these files are cached for one year with no revalidation.

The name `index.html` does not change. If it were cached for a long time, readers would keep receiving the old `index.html` after you publish a new version. So the instruction is "you may cache this, but always check with the origin before using it". CloudFront performs this check as a conditional request to S3, and if nothing has changed the body is not transferred.

Thanks to this policy, an ordinary publish needs **no cache invalidation**. An invalidation is an operation that makes edge caches discard objects before they expire. `vp run spa:invalidate` is provided for recovery when something was published with the wrong headers, but it is not used day to day.

### The order matters

Publishing happens in this order.

1. Upload the hashed assets
2. Upload `index.html` and the like
3. Delete pages that are no longer part of the build
4. Delete assets that are not in the current build and were uploaded 30 or more days ago
5. Put `aih-revision.json`, which records which revision was published

What happens with 1 and 2 reversed? There would be a moment when the new `index.html` points to JavaScript that does not exist yet.

Old assets are not deleted right away for the same reason. A reader who opened the page shortly before the publish holds the old `index.html`. When that reader later switches screens, the old assets are requested.

If it fails partway, running it again continues from where it stopped, because files whose contents are the same are not uploaded again. If it stopped in the middle of step 1, the bucket only gains files that nothing refers to, and the published site does not change.

This is a small distributed system. The bucket, the edge caches in each location, and the readers' browsers each hold contents from a different point in time. There is no moment at which everyone switches to the new version at once. The invariant being kept is: "the files that the `index.html` in a reader's hands points to can always be fetched".

## Confirm that it arrived

<!-- section: 03.smoke -->

```bash
vp run spa:smoke
```

A command that exits successfully is not proof that anything reached readers. This task fetches the published URLs and checks them.

- `/` returns HTML with a `Cache-Control` that requires revalidation
- `/notes/aih-smoke-deep-link` returns the app's `index.html`
- `/assets/aih-smoke-missing.js` is a 404 (not HTML with 200)
- A hashed asset has a one-year `Cache-Control`
- Opening the site over HTTP redirects to HTTPS
- The revision in `aih-revision.json` matches your local commit

The last check is the confirmation that the publish has reached CloudFront. It retries every 15 seconds until the revisions match and gives up after 10 minutes.

## Check for drift

```bash
vp run spa:infra:drift
```

This is the same gate as in chapter 02. There is one thing to watch. This stack contains an `AWS::CloudFront::Function`, and the pinned version of cdkd handles this resource type through the Cloud Control API, not through a dedicated implementation. What the read-back returns has not been checked against real AWS. If `unsupported` or `incomplete` appears, the gate fails (exit code 11). That means "could not be checked", not "there is drift".
