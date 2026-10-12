---
title: "09 SSR: Deploy"
---

# 09 SSR: Deploy

This page puts the build you [checked locally](/en/chapters/09-ssr/local.md) on AWS and checks that the cache boundary also holds in CloudFront.

## Deploying and checking

<!-- section: 09.deploy -->

I have not yet run the steps on this page against a real AWS account. The steps and the tasks are in place.

The first time, run the tasks in this order.

```bash
vp run build:ssr
vp run ssr:infra:diff
vp run ssr:infra:deploy
vp run ssr:assets:plan
vp run ssr:assets:publish
```

`ssr:infra:deploy` deploys the build that is in `.output` at that moment. The stack has to come first because the bucket for the assets does not exist yet. On the first deploy, this leaves a few tens of seconds in which the JavaScript that the HTML points at is not in S3.

From the second time on, reverse the order.

```bash
vp run build:ssr
vp run ssr:assets:publish
vp run ssr:infra:deploy
```

The new assets go up before the function is replaced, so by the time the new HTML starts going out, the files it points at are already in S3.

<<< @/examples/09-ssr/scripts/asset-plan.ts{plan}

Hashed files are only added and never overwritten. Files from older builds are not deleted right away and stay for 7 days. "How stale a page may be" on this page explains why.

Once the assets are up, check the site.

```bash
vp run ssr:smoke
```

<<< @/examples/09-ssr/scripts/smoke-spec.ts{spec}

The task checks five things.

1. When `/` is opened several times, the response header is `public, max-age=0, s-maxage=60`, and at least one of the later responses comes from CloudFront's cache
2. When `/me` is opened with a made-up session cookie and with no cookie, and `/me/api/viewer` with the cookie, three times each in turn, the header is `private, no-store` and no response ever comes from the cache
3. A `/_nuxt/` file that the HTML points at comes back marked `immutable`
4. Opening the function URL directly returns 403
5. CloudFront refuses POST

Number 2 is the check of this chapter's invariant in a real environment. Whether a response came from the cache is judged from its `x-cache` and `age` headers. I have not yet confirmed how CloudFront actually returns those two.

The drift check is the same as in chapter 02.

```bash
vp run ssr:infra:drift
```

## How stale a page may be

<!-- section: 09.stale -->

A cache is also a mechanism that returns old content. In exchange for speed, you have to decide in advance who may be shown stale content and how stale it may be.

This chapter decides as follows.

- Public pages (`/`, `/notes/:id`, `/api/notes`): everyone may receive something up to 60 seconds old
- Under `/me`: nothing stale. Lambda answers every time

The value 60 is defined in one place, `SHARED_SECONDS`, and both the app's header and CloudFront's `maxTtl` are built from it.

```figure
caption: Each edge location has its own cache, so the moment a new note becomes visible differs from reader to reader.
type: sequence
actor tokyo: reader in Tokyo
actor lambda: Lambda
actor london: reader in London
note lambda: t0 note "A" is published (deploy)
step tokyo -> lambda: t0+5 opens /
step lambda --> tokyo: renders; cached
step london -> lambda: t0+20 opens /
step lambda --> london: renders; cached at another edge
note lambda: t0+30 note "B" is published (deploy)
note tokyo: t0+40 reload: still without B
note london: t0+40 reload: still without B
step tokyo -> lambda: t0+65 reloads
step lambda --> tokyo: renders; has B
step london -> lambda: t0+80 reloads
step lambda --> london: renders; has B
```

Each edge location has its own cache. At the same instant, a reader in Tokyo may therefore see the new list while a reader in London sees the old one. You cannot say that everyone switches over together. All you can say is that no reader sees anything more than 60 seconds old.

If old HTML stays for 60 seconds, the JavaScript that the old HTML points at is needed for at least 60 seconds too. Someone who leaves a tab open comes back for the old files much later than that. That is why `ssr:assets:publish` keeps the files of older builds for 7 days. When HTML and assets are served from different places, you have to consider their two lifetimes together.

When you cannot wait 60 seconds, you can use invalidation, as in chapter 03. Invalidation makes CloudFront ask the origin again from the next request on. It does not guarantee that the change takes effect at every edge at the same moment.

Errors are cached too. By default CloudFront stores a 404 or a 5xx from the origin for 10 seconds. The app puts `no-store` on every response that is not a 200, but I could not work out from the documentation what happens to the 10 seconds in that case. No cookie reaches the public side, so even if the response is stored, it is an error page that belongs to nobody.
