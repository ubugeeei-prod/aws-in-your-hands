---
title: "09 SSR: Deploy"
---

# 09 SSR: Deploy

## Deploy and check

<!-- section: 09.deploy -->

From here on, I haven't yet got this through a real AWS account. The steps and the tasks are in place.

The first time, the order is this.

```bash
vp run build:ssr
vp run ssr:infra:diff
vp run ssr:infra:deploy
vp run ssr:assets:plan
vp run ssr:assets:publish
```

`ssr:infra:deploy` deploys the build that is in `.output` right now. The stack comes first because the bucket for the assets doesn't exist yet. For those few tens of seconds, the JavaScript the HTML points at isn't in S3.

From the second time on, reverse the order.

```bash
vp run build:ssr
vp run ssr:assets:publish
vp run ssr:infra:deploy
```

Put the new assets in place first, then swap the function. By the time the new HTML starts going out, the files it points at are already in S3.

<<< @/examples/09-ssr/scripts/asset-plan.ts{plan}

Hashed files are only added, never overwritten. Files from older builds aren't deleted right away; they stay for 7 days. Why they stay is the next section.

Once they're up, check.

```bash
vp run ssr:smoke
```

<<< @/examples/09-ssr/scripts/smoke-spec.ts{spec}

It looks at five things.

1. Open `/` several times: the response header is `public, max-age=0, s-maxage=60`, and at least one of the later responses comes from CloudFront's cache
2. Open `/me` and `/me/api/viewer` over and over, alternating a made-up session cookie with no cookie: always `private, no-store`, and never once from the cache
3. A `/_nuxt/` file that the HTML points at comes back marked `immutable`
4. Opening the function URL directly returns 403
5. CloudFront turns POST away

Number 2 is the check that looks at this chapter's invariant in a real environment. Whether a response came from the cache is judged from its `x-cache` and `age` headers. I haven't yet seen with my own eyes how CloudFront actually returns those two.

Checking for drift is the same as in chapter 02.

```bash
vp run ssr:infra:drift
```

## Who sees stale content, and for how long

<!-- section: 09.stale -->

A cache is also a mechanism for returning old content. In exchange for speed, whom do you allow to see something stale, and how stale? Decide it up front.

This chapter's answer:

- Public pages (`/`, `/notes/:id`, `/api/notes`): everyone may receive something up to 60 seconds old
- Under `/me`: nothing stale. Lambda answers every time

The number 60 lives in one place (`SHARED_SECONDS`), and both the app's header and CloudFront's `maxTtl` are built from it.

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

Each edge location has its own cache. At the same instant, a reader in Tokyo may see the new list while a reader in London sees the old one. You can't say everyone switches over together. What you can say stops at "no reader sees anything more than 60 seconds old."

If old HTML lives for 60 seconds, the JavaScript that old HTML points at is needed for at least 60 seconds too. Someone who leaves a tab open will come for the old files much later than that. That's why `ssr:assets:publish` keeps the files of older builds for 7 days. When HTML and assets are served from different places, you have to think about their two lifetimes together.

When you can't wait, the invalidation from chapter 03 is available. But it means "ask the origin again from the next request on," not a guarantee that it takes effect at every edge at the same moment.

Errors have a cache too. CloudFront stores a 404 or a 5xx from the origin for 10 seconds by default. The app puts `no-store` on everything that isn't a 200, but what happens to the 10 seconds in that case, I couldn't settle from the documentation. No cookie reaches the public side, so even if it is stored, it's an error page that belongs to nobody.
