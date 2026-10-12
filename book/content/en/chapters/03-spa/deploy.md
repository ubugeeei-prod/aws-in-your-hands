---
title: "03 Static Hosting: Deploy"
---

# 03 Static Hosting: Deploy

On this page you create the bucket and the distribution in AWS, publish the built SPA, and confirm that it reached readers.

## Deploy

<!-- section: 03.deploy -->

This page assumes you set up `.env` and ran `vp run infra:bootstrap` in chapter 02.

```bash
vp run spa:infra:diff
vp run spa:infra:deploy
```

After a distribution is created and the API has responded, the change is still being propagated to edge locations around the world. This book's deploy task passes `--full-wait` to cdkd and waits until propagation finishes. How long that takes has not been measured.

When the deploy finishes, `DistributionDomainName` shows a domain name of the form `dxxxxxxxxxxxx.cloudfront.net`. The bucket is empty at this point, so opening the URL shows nothing.

From here on, the tasks that touch AWS have not yet been run through in a real account. The breakdown is in the [verification notes at the end of the chapter](/en/chapters/03-spa/wrap.md).

### Creating infrastructure and publishing content are separate jobs

Where this differs from working with Cloudflare Pages or Vercel is that you create the infrastructure and publish the content with separate tasks.

- `spa:infra:deploy` creates and changes infrastructure. It changes the bucket, the distribution, and the function, and you rarely run it
- `spa:publish` publishes content. It changes the objects in the bucket, and you run it every time the app changes

Running `spa:infra:deploy` does not publish a new version of the app, and `spa:publish` does not touch the settings of the bucket or the distribution. Keeping the two apart lets you update content quickly and leaves cdkd as the only thing that manages the infrastructure.

## Publish

<!-- section: 03.publish -->

```bash
vp run spa:publish:plan
vp run spa:publish
```

`spa:publish:plan` only shows what would be uploaded and what would be deleted, and changes nothing. `spa:publish` is the task that publishes. Both run `vp run build:spa` first.

The publish code is split into a part that decides what to do and a part that does it. The deciding part is a pure function, so it can be tested without AWS.

### Cache policy

<<< @/tools/src/site/plan.ts{cache}

Vite puts a hash of the content into the names of the files under `assets/`. When the content changes the name changes, so the content at a given URL never changes. Those files are therefore cached for one year with no revalidation.

The name of `index.html` does not change. If it were cached for a long time, readers would keep receiving the old `index.html` after a new version was published. So its header says that it may be cached but must be checked with the origin before each use. CloudFront makes this check as a conditional request to S3, and the body is not transferred if nothing has changed.

Because of this policy, an ordinary publish **needs no cache invalidation**. An invalidation makes the edge discard cached content before it expires. `vp run spa:invalidate` exists for recovering after publishing with a wrong header, but it is not used in normal operation.

### The order of a publish

A publish goes in this order.

1. Upload the hashed assets
2. Upload `index.html` and the like
3. Delete pages that are no longer in the build
4. Delete assets that are not in the current build and were uploaded 30 or more days ago
5. Put `aih-revision.json`, which records which revision was published

If steps 1 and 2 were reversed, there would be a period in which the new `index.html` pointed at JavaScript that did not exist yet.

Old assets are kept for a while for the same reason. A reader who opened the page just before a publish holds the old `index.html`. When that reader later switches screens, the old assets are requested.

If a publish fails partway, running it again continues from where it stopped, because files whose content is unchanged are not uploaded again. If it stops during step 1, the bucket only gains files that nothing refers to, and the published site does not change.

This procedure is a small distributed system. The bucket, the edge caches around the world, and readers' browsers each hold content from a different point in time, and there is no moment at which everyone switches to the new version together. The invariant the procedure keeps is that the files referenced by the `index.html` a reader holds can always be fetched.

## Confirm that it arrived

<!-- section: 03.smoke -->

```bash
vp run spa:smoke
```

A publish command that ended successfully is not proof that the content reached readers. This task fetches the published URLs and checks the following.

- `/` returns HTML with a `Cache-Control` that requires revalidation
- `/notes/aih-smoke-deep-link` returns the app's `index.html`
- `/assets/aih-smoke-missing.js` returns 404 (not HTML with a 200)
- A hashed asset has a one-year `Cache-Control`
- Opening the site over HTTP redirects to HTTPS
- The revision in `aih-revision.json` matches the local commit

The last check confirms that the new content has reached CloudFront. It retries every 15 seconds until the revisions match and gives up after 10 minutes.

## Check for drift

```bash
vp run spa:infra:drift
```

This uses the same gate as chapter 02. One point needs attention in this chapter. The stack contains an `AWS::CloudFront::Function`, and the pinned version of cdkd handles that resource type through the Cloud Control API, not with a dedicated implementation. What the read-back returns has not been checked in real AWS. If the result is `unsupported` or `incomplete`, the gate fails with exit code 11. That failure means the stack could not be checked, not that it has drifted.
