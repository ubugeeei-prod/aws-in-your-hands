---
title: 03 Static Hosting: A Private S3 Origin and CloudFront
sourceRevision: 2
---

# 03 Static Hosting: A Private S3 Origin and CloudFront

With the tools in place, you publish your first app: a notes app that runs entirely in the browser.

In this chapter you run and test an SPA built with Vue, Vite, and Vize on your machine, put it in an S3 bucket, and publish it over HTTPS through CloudFront. The bucket stays unreadable directly from the internet. Opening a client-side URL such as `/notes/abc` directly shows the app, and a file that does not exist returns 404. At the end you fetch the published URLs to confirm that the content reached readers.

This chapter builds on [chapter 02](/en/chapters/02-toolchain.md). The code is in `examples/03-spa/`. There is no custom domain, and the site is published at the `https://dxxxxxxxxxxxx.cloudfront.net` URL that CloudFront issues.

## The big picture

<!-- section: 03.architecture -->

```figure
caption: The browser talks only to CloudFront, and CloudFront reads the files from the S3 bucket with a signed request.
node browser: Browser
node fn: CloudFront Function | viewer-request, "spa-fallback"
node cache: cache
node index: index.html
node js: assets/index-<hash>.js
node css: assets/index-<hash>.css
edge browser -> fn: HTTPS
edge fn -> cache
edge cache -> index: SigV4 (origin access control)
edge cache -> js
edge cache -> css
group cf: CloudFront distribution (edge locations) = fn, cache
group s3: S3 bucket (ap-northeast-1, Block Public Access on) = index, js, css
```

```figure
caption: The spa-fallback function rewrites /notes/abc to /index.html and leaves /assets/app-1a.js unchanged.
direction: right
node screen: /notes/abc
node file: /assets/app-1a.js
node rewritten: /index.html
node same: unchanged
edge screen -> rewritten: spa-fallback
edge file -> same: spa-fallback
```

The app's code runs in **the browser**. The only code of yours that runs in AWS is a CloudFront Function of a dozen or so lines. S3 is used as storage for the files, not as a web server. CloudFront is a CDN whose sites around the world, called edge locations, cache responses and return them from a place close to the reader. CloudFront also terminates HTTPS.

Two terms are worth learning now. One CloudFront configuration is called a distribution, and the place CloudFront fetches the original files from is called an origin. In this chapter the origin is an S3 bucket.

### Why the bucket is not made public

S3 has a feature called static website hosting, which turns a public bucket into a site. This book does not use it, for two reasons. The URL that feature gives you is HTTP only, so HTTPS needs CloudFront anyway. And a setting that makes a bucket public is a source of accidents. So in this chapter the bucket stays private and only CloudFront reads it.

Other choices fit some cases better, though.

- If what you mainly want is to publish by pushing to Git, or to have preview environments, Cloudflare Pages or Vercel will probably take fewer steps. With this chapter's architecture you set up that machinery yourself, and in return you can later connect an API and authentication inside the same account
- If you need server-side rendering, go to [chapter 09](/en/chapters/09-ssr.md). This chapter's architecture returns static files only
