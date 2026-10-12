---
title: "09 SSR: A BFF, and Nuxt on Regional Lambda"
sourceRevision: 2
---

# 09 SSR: A BFF, and Nuxt on Regional Lambda

In chapter 03 you put finished HTML and JavaScript in S3 and served them. In chapter 04 you put a function on Lambda that runs for each request. This chapter joins the two. A Nuxt app runs on Lambda and builds the HTML for every request. That's server-side rendering (SSR).

Getting it to run isn't the hard part. The cache is. CloudFront stores one response and hands the same thing to the next person who asks. For a public page, that's what makes it fast. For the page of someone who is signed in, it means a stranger receives it. Half of this chapter is about building things so that this accident doesn't happen.

You need [chapter 03](/en/chapters/03-spa.md) and [chapter 04](/en/chapters/04-http-api.md). The code is in `examples/09-ssr/`. Nothing here is billed by the hour.

## The big picture

<!-- section: 09.architecture -->

```figure
caption: CloudFront splits requests three ways by path: S3 answers /_nuxt/*, and Lambda answers everything else.
node browser: Browser
node cf: CloudFront distribution | edge locations
node nuxt: /_nuxt/*
node me: /me, /me/* | never cached, cookies forwarded
node other: everything else | cached if the response allows, cookies dropped
node s3: S3 bucket | private, OAC
node furl: Lambda function URL | OAC
node nitro: Nitro handler | Nuxt renders pages, server routes answer /api/* and /me/*
node logs: CloudWatch Logs | kept 7 days
edge browser -> cf: HTTPS
edge cf -> nuxt
edge cf -> me
edge cf -> other
edge nuxt -> s3: hashed JS and CSS
edge me -> furl
edge other -> furl
edge furl -> nitro
edge nitro -> logs
group fn: Lambda function (ap-northeast-1, Node.js 24, arm64, 512 MB, timeout 10 s) = furl, nitro
mark nitro
```

There is one way in: a CloudFront distribution. It looks at the path and sends the request to one of three places.

`/_nuxt/*` is the JavaScript and CSS that Nuxt writes at build time. The file names carry a hash of the content, so, as in chapter 03, they sit in S3 and are cached for a long time. Lambda doesn't start for them.

Everything else reaches Lambda, where Nuxt builds the HTML and returns it. Within that, everything from `/me` down is treated differently: it's the place where the content might depend on who is looking. Nothing there is cached, ever.

The app is small. A list of public notes (`/`), a page for each (`/notes/:id`), and your own page (`/me`).

### This is not edge rendering

The HTML is built by a Lambda function in the Tokyo region. Not at a CloudFront edge location.

CloudFront stands in front, so a response that is in the cache comes back from near the reader. One that isn't travels to Tokyo, runs Lambda, and travels back. A reader in London who opens a page that isn't cached waits for the round trip to Tokyo.

You can't say "it's behind a CDN, so it runs at the edge." This book calls it regional SSR. What code can run at the edge, and under which limits, is covered in [chapter 10](/en/chapters/10-edge.md).

### When you don't need SSR

SSR is not always better than a SPA. It adds a Lambda function, a cache to design, and more places to fail.

- An app that shows nothing until you sign in. With no HTML for a search engine to read, the SPA from chapters 03 and 06 is enough
- A site whose content is fixed at build time. Build all the HTML first, put it in S3, and you need no Lambda. This book's own site works that way

SSR pays off for pages that are public, whose content is decided at request time, and where the first paint or the HTML a search engine sees matters.

## Shaping Nuxt for Lambda

<!-- section: 09.nitro -->

The server side of Nuxt is handled by a separate package, Nitro. Nitro has presets that change the shape of the build output to suit where it will run, and one of them is for AWS Lambda.

The versions are pinned. Nuxt is 4.6.1. The Nitro that this Nuxt uses is `nitropack` 2.13.4. npm also has a 3.x beta published under the name `nitro`, but Nuxt 4.6.1 depends on the 2.x line, so that is the one to read. What follows was checked against the source of the pinned `nitropack` (`dist/presets/aws-lambda/`) and against an actual build, not against documentation.

<<< @/examples/09-ssr/nuxt.config.ts{config}

The preset is named `aws-lambda`. It has a single option, `awsLambda.streaming`. `nuxt dev` doesn't use the preset; it takes effect only for `nuxt build`.

The `import type {} from "@nuxt/nitro-server"` at the top is one line for the type checker. Without it, the types of Nuxt 4.6.1 treat the contents of `nitro` as belonging to "some version of Nitro, unknown which," and writing `preset` alone is a type error. With it, the object is checked against the types of the pinned `nitropack`, so a misspelt option name gets caught.

A build produces this.

```text
examples/09-ssr/.output/
  nitro.json            preset, Nitro version, awsLambda.streaming
  server/
    index.mjs           exports `handler`
    chunks/             the bundled application
    node_modules/       only the packages the server imports
    package.json
  public/
    _nuxt/              content-hashed JS and CSS
    _nuxt/builds/       latest.json: which build is current
```

`server/` is the directory that goes to Lambda as it is. Nitro gathers the `node_modules` it needs in there too, so CDK doesn't have to bundle anything the way it did in chapter 04. `public/_nuxt/` is what goes to S3.

The `handler` that `index.mjs` exports comes in two shapes.

- `streaming: false` (the default). `handler(event, context)` returns an object with `statusCode`, `headers`, `cookies`, and `body`. It builds the whole response, then returns it
- `streaming: true`. The handler is wrapped in `awslambda.streamifyResponse`, which the Lambda Node.js runtime provides, and writes the response to a stream

Which shape was built is recorded in `nitro.json`. The CDK stack you'll see later reads that file to decide the setting on the Lambda side.

<<< @/examples/09-ssr/scripts/lambda-harness.ts{nitro-json}

Build output is a value from outside the type system, so it goes through a schema here as well.

### Vize works as it is

Compiling, type checking, and linting `.vue` files is Vize's job, as in chapters 03 and 06. Add `@vizejs/nuxt` 0.443.0 to `modules` and both `nuxt dev` and `nuxt build` compile `.vue` files with Vize. Both ran locally.

Type checking and linting run outside Nuxt, with `vize check` and `vize lint` (`typecheck:ssr` and `lint:ssr`). For that reason the `.vue` files don't lean on Nuxt's auto-imports; they import `useFetch` and the rest explicitly from `nuxt/app`. How far Vize can follow types when auto-imports are used wasn't checked.

One detail. `@vizejs/nuxt` 0.443.0 depends on an old `@nuxt/kit` (3.11.2), and the install prints one peer dependency warning. It had no effect on the build or the dev server.

## Keep the app small

<!-- section: 09.app -->

The shape of a note becomes a schema, the same way as in chapter 04.

<<< @/examples/09-ssr/core/notes.ts{note}

Here is the list page.

<<< @/examples/09-ssr/app/pages/index.vue

While the server is building the HTML, `useFetch("/api/notes")` calls the route directly inside the same process. No HTTP is involved. When the same code runs in the browser (you clicked a link and the view changed), it is a real HTTP request. Either way, the value that comes back goes through the schema before it is used.

All `/api/notes` does is return the notes that ship with the code.

<<< @/examples/09-ssr/server/context.ts{context}

Not reading the notes from DynamoDB is deliberate. This chapter was meant to need only chapters 03 and 04, and, as chapter 04 showed, data written into Lambda's memory can't be the owner of anything. Read-only data that ships with the code gives the same answer from every execution environment. To read from the table of chapter 05 instead, the one line to replace is `notes`.

`core/` holds TypeScript that knows about neither Nuxt nor AWS. The decisions are written there, and that's what the tests exercise. `server/` and `app/` are a thin layer that connects it to Nuxt.
