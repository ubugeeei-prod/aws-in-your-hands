---
title: Reproduce This Site
sourceRevision: 2
---

# Reproduce This Site

The site you are reading is made of the same parts the book explains. Ox Content generates static HTML, the HTML goes into a private S3 bucket, and CloudFront serves it. The infrastructure is defined with CDK in TypeScript and created with cdkd.

This page explains how to rebuild the same site in your own account and how the site is put together. It assumes you have read [chapter 02](/en/chapters/02-toolchain.md) and [chapter 03](/en/chapters/03-spa.md).

What has been checked locally is the build, the link check, and the CDK synth and assertions. Deploying to AWS, publishing, and the smoke test have not been run yet. This site has no public URL yet either.

## The big picture

<!-- section: book.architecture -->

```figure
caption: The pages, the data, and the code imported from the examples are built into book/dist/, and publish puts that in S3.
node content: book/content/{ja,en}/**/*.md
node data: data/*.json
node examples: examples/** | snippets
node build: vp run build:book | Ox Content, static site generation
node pages: index.html, 404.html | {ja,en}/.../index.html
node assets: search-index.json | assets/<name>-<hash>.{css,js}
node publish: vp run book:publish | S3 PutObject, does not touch infrastructure
node s3: S3 bucket | private
edge content -> build
edge data -> build
edge examples -> build
edge build -> pages
edge build -> assets
edge pages -> publish
edge assets -> publish
edge publish -> s3
group dist: book/dist/ = pages, assets
```

```figure
caption: A reader's request goes through CloudFront to the private S3 bucket, and a 403 or 404 from S3 comes back as /404.html.
direction: right
node reader: Reader
node cf: CloudFront distribution | viewer-request: url-rewrite function
node s3: S3 bucket | private
edge reader -> cf
edge cf -> s3
edge s3 --x cf: 403/404
edge cf --> reader: /404.html, status 404
```

The book's site and the SPA from chapter 03 are separate things, with separate stacks, buckets, and URLs.

- The book's site is the stack `AihBookSite`, defined in `book/infra/`. It serves HTML per page (SSG) and is built with `vp run build:book`
- The SPA from chapter 03 is the stack `AihSpa`, defined in `examples/03-spa/infra/`. It serves a single `index.html` (SPA) and is built with `vp run build:spa`

## Content and build

<!-- section: book.build -->

```bash
vp run dev:book
vp run build:book
vp run preview:book
```

`dev:book` is a development server that reloads each time you save a file. `build:book` writes static files to `book/dist/`. None of these tasks touches AWS.

The configuration is the one file below.

<<< @/book/vite.config.ts

These are the Ox Content features in use. Each is present in the type definitions of the pinned version (3.2.14) and has been confirmed with an actual build.

| Feature | Configuration |
| --- | --- |
| Japanese and English routes, and language switching | `i18n` and `ssg.localeSwitcher`. `content/ja/` and `content/en/` become `/ja/` and `/en/` as they are |
| Search | Enabled by default. `search-index.json` is output |
| Moving to the previous and next page | `ssg.pagination` |
| Copying code | `ssg.readerChrome` |
| Table of contents on the right | `theme.aside` |
| Dark mode, mobile menu | Included in the default theme |
| Importing code from real files | `codeImports`. Written as `<<< @/path{region}` |

All code in the text is imported from real files with the last feature, so the Japanese and English versions point at the same range of the same file.

The sidebar is built from the chapter list (`data/chapters.json`).

<<< @/book/site.ts

### Pages that are not written by hand

The pricing, sources, glossary, validation record, and toolchain pages, and the outlines of unwritten chapters, are not written by hand. Both the Japanese and English versions are generated from the JSON in `data/`.

```bash
vp run book:generate
vp run book:generate:check
```

`book:generate:check` fails if the generated files are out of date. `build:book` runs this check before it builds.

### Checking that the two languages and the code agree

```bash
vp run content:check
```

This check runs entirely on your machine and confirms the following.

- Every page exists in both Japanese and English
- Section markers, code imports, diagrams, the number of headings, and the number of code blocks match between the two languages
- The imported files and ranges exist and are distributed by git
- For each chapter, the revision number of the Japanese version matches the revision number the English version was translated from
- The per-section source map (`data/section-map.json`) corresponds to the markers in the text with nothing missing and nothing extra, and the files and tasks it lists exist

## URL handling

<!-- section: book.routing -->

Ox Content outputs `ja/chapters/03-spa.md` as `ja/chapters/03-spa/index.html` and writes links within pages in the form `/ja/chapters/03-spa/index.html`. The URL a reader types, or a link from another site, will more likely be `/ja/chapters/03-spa/`.

A private S3 origin does not map a directory to `index.html`. That mapping is a feature of S3 static website hosting, and using it means the bucket cannot be protected with OAC. So a CloudFront Function does the mapping.

<<< @/book/infra/functions/url-rewrite.js

For each URL a reader requests, the function behaves as follows.

- `/ja/chapters/03-spa/` is rewritten to `/ja/chapters/03-spa/index.html`
- `/ja/chapters/03-spa` is redirected to `/ja/chapters/03-spa/` with a 301, so that one page does not get two URLs
- `/assets/...css` and `/search-index.json` are left alone
- For a page that does not exist, the object for the rewritten path is not in S3, so the result is a 404

Unlike the SPA in chapter 03, the site does **not return `index.html`** for a URL that does not exist, because on the book's site that would make every broken link look like the top page.

The 404 is handled on the distribution.

<<< @/book/infra/lib/book-site-stack.ts{distribution}

This bucket policy allows only `s3:GetObject`, so S3 returns 403 for an object that does not exist. For that reason both 403 and 404 are replaced with the generated `404.html` and status code 404.

The function's test loads and runs the very file that gets deployed. After the build, another check confirms that the target of every internal link exists.

```bash
vp run links:check
```

## Infrastructure

<!-- section: book.infra -->

<<< @/book/infra/lib/book-site-stack.ts{bucket}

<<< @/book/infra/lib/book-site-stack.ts{rewrite}

<<< @/book/infra/lib/book-site-stack.ts{outputs}

The cache and response headers use AWS managed policies. A `CachePolicy` or `ResponseHeadersPolicy` that you define yourself is handled through the Cloud Control API in the pinned version of cdkd. The fewer resource types in use, the less there is to verify.

The site uses five resource types. A test pins this list, and adding a type makes the test fail. The test exists so that nobody can skip the step of confirming, before adding a type, that the pinned version of cdkd can create it and read it back.

How cdkd 0.296.28 handles each type was confirmed in its source.

- `AWS::S3::Bucket` and `AWS::S3::BucketPolicy` have a dedicated implementation
- `AWS::CloudFront::Distribution` and `AWS::CloudFront::OriginAccessControl` also have a dedicated implementation
- `AWS::CloudFront::Function` goes through the Cloud Control API. An actual deploy of this one has not been confirmed yet

`BucketDeployment`, the CDK construct that places files in a bucket at deploy time, is not used, so that publishing content stays separate from updating infrastructure.

### Rules for using cdkd

cdkd's official documentation describes cdkd as intended for development and testing, and recommends the AWS CDK CLI for production (checked 2026-10-11). This book's site is managed with cdkd as the author's choice. Given that, three rules apply.

- Do not manage this stack alternately with CloudFormation. Create, update, diff, drift detection, and delete all go through the cdkd path
- Do not delete the state bucket (`cdkd-state-<account ID>`). Versioning is enabled, so a state overwritten by mistake can be restored from an earlier S3 version
- Know what happens when a deploy fails. By default cdkd deletes what it created and returns what it updated to the previous configuration (according to the source of the pinned version; the actual behavior has not been confirmed)

## Publishing

<!-- section: book.publish -->

Create the infrastructure the first time only. Setting up `.env` and running `vp run infra:bootstrap` are as described in chapter 02.

```bash
vp run book:infra:diff
vp run book:infra:deploy
```

Once the infrastructure exists, publish the content.

```bash
vp run book:publish:plan
vp run book:publish
vp run book:smoke
```

This table lists the tasks involved, with whether each one touches AWS.

| Task | What it does | AWS |
| --- | --- | --- |
| `build:book` | Runs `book:generate:check`, then builds with Ox Content | Not touched |
| `book:infra:synth` | Turns the CDK code into a template | Not touched |
| `book:infra:diff` | Compares the template with cdkd's state | Reads |
| `book:infra:deploy` | Creates or changes the bucket, distribution, and function | Changes |
| `book:publish:plan` | Runs `build:book`, then shows the publish plan | Reads |
| `book:publish` | Runs `build:book`, then places `book/dist/` in the bucket | Changes (bucket contents only) |
| `book:smoke` | Fetches the public URLs and checks them | Reads |
| `book:infra:drift` | Compares the state with the actual resources | Reads |
| `book:invalidate` | Makes the edge discard its cache (for recovery) | Changes |
| `book:unpublish` | Empties the bucket | Changes |
| `book:infra:destroy` | Deletes the stack | Changes |

Every task that reads or changes AWS has `cache: false`. None is called from `dev:book` or `check:all`, the tasks used in everyday writing. The target account is `AIH_AWS_ACCOUNT_ID`, the Region is `AIH_AWS_REGION` (default `ap-northeast-1`), and the stack is `AihBookSite`.

`book:infra:deploy` alone does not update the text, and `book:publish` alone does not change the configuration of the bucket or the distribution. The publish script neither creates the bucket or distribution nor changes their configuration.

The cache policy, the upload order, and the handling of a failure partway through use the same implementation (`tools/src/site/`) as ["Publish" in chapter 03](/en/chapters/03-spa/deploy.md). HTML and `search-index.json` are revalidated with the origin every time, and everything under `assets/` is cached for one year. A normal publish needs no invalidation.

`book:smoke` checks the following. Publishing counts as complete when this check passes, not when the CLI exits successfully.

- `/`, `/ja/`, `/en/`, and a chapter page in each language return 200 with the correct `<html lang>`
- A URL without the trailing `/` is redirected with a 301
- A page that does not exist returns 404
- Hashed assets carry a one-year `Cache-Control`
- HTTP is redirected to HTTPS
- `aih-revision.json` matches the revision of the local commit

### Rolling back a published version

Versioning is not enabled on the bucket. When you want to go back to an earlier version, build the earlier commit and publish it again.

```bash
git switch --detach <commit to restore>
nix develop --command vp install --frozen-lockfile
nix develop --command vp run book:publish
nix develop --command vp run book:smoke
```

`flake.lock` and `pnpm-lock.yaml` are the ones from that commit, so the site is built with the tool versions of that time. When you are done, return to the original branch with `git switch -`.

### Custom domain

A custom domain is not supported yet. When it is added, the Route 53 hosted zone and the ACM certificate in `us-east-1` will be defined in the same `book/infra/`. At that point, setting `AIH_BOOK_SITE_URL` at build time makes Ox Content output canonical and hreflang links. While there is no real URL, it is left unset.

## What it costs

The calculation is the same as in chapter 03. [Pricing Worksheets](/en/reference/pricing.md) has two worked examples.

- A month in which the site is published and nobody reads it: USD 0.00 at list price (storing 50 MB in S3 comes to less than 0.01)
- A month assuming 20,000 page views: USD 0.50 at list price, or USD 0.03 after subtracting CloudFront's monthly free allowance

Access logs, AWS WAF, and a custom domain are not used.

## Clean up

<!-- section: book.cleanup -->

```bash
vp run book:unpublish --yes
vp run book:infra:destroy
```

What remains is the state bucket, the asset bucket, and the ECR repository created by bootstrap in chapter 02. Delete those three with the procedure in chapter 02 once no other stack remains. This stack creates no logs, so nothing else is left.

## If you publish from CI

When you publish from CI instead of a person's terminal, use the same Nix lock and the same `vp run` tasks. An example is in `docs/examples/book-publish.yml`. For AWS authentication, use short-lived credentials obtained through OIDC, not long-term access keys. The definition of that role is to be covered in chapter 20 (planned) and is not in this repository yet.

::: details Verification notes for this page

**Checked locally.** The build, the link check, and the CDK synth and assertions.

**Not checked yet.** Deploying to AWS, publishing, and the smoke test have not been run. An actual deploy of `AWS::CloudFront::Function`, and what cdkd really does when a deploy fails, are also unconfirmed. This site does not have a public URL yet.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Content and build | `book/vite.config.ts`, `book/site.ts`, `book/content/`, `tools/src/book/generate.ts`, `tools/src/checks/content.ts`, `data/` | `dev:book`, `build:book`, `preview:book`, `book:generate`, `book:generate:check`, `content:check` |
| URL handling | `book/infra/functions/url-rewrite.js`, `book/infra/test/url-rewrite.test.ts`, `tools/src/checks/links.ts` | `test:unit`, `links:check` |
| Infrastructure | `book/infra/lib/book-site-stack.ts`, `book/infra/bin/app.ts`, `book/infra/cdk.json`, `book/infra/test/book-site-stack.test.ts` | `book:infra:synth`, `book:infra:diff`, `book:infra:deploy`, `book:infra:drift` |
| Publishing | `tools/src/site/` | `book:publish:plan`, `book:publish`, `book:smoke`, `book:invalidate` |
| Clean up | `tools/src/site/unpublish.ts` | `book:unpublish`, `book:infra:destroy` |

:::
