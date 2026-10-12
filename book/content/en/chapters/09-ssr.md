---
title: "09 SSR: A BFF, and Nuxt on Regional Lambda"
sourceRevision: 4
---

# 09 SSR: A BFF, and Nuxt on Regional Lambda

In chapter 03 you served prebuilt HTML and JavaScript from S3. In chapter 04 you put a function on Lambda that runs for each request. This chapter combines the two: a Nuxt app runs on Lambda and builds the HTML for every request, an arrangement known as server-side rendering (SSR).

Getting it to run is not the hard part. The cache is. CloudFront stores a response and returns the same one to the next person who asks. That makes a public page fast, but if CloudFront stores the page of someone who is signed in, another person receives it. Half of this chapter goes into building the app so that this cannot happen.

You need [chapter 03](/en/chapters/03-spa.md) and [chapter 04](/en/chapters/04-http-api.md). The code is in `examples/09-ssr/`. The chapter creates no resource that is billed by the hour.

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

Every request enters through one CloudFront distribution, which looks at the path and sends the request to one of three places.

`/_nuxt/*` is the JavaScript and CSS that Nuxt writes at build time. The file names contain a hash of the content, so, as in chapter 03, the files sit in S3 and are cached for a long time. Lambda does not start for these paths.

The remaining requests reach Lambda, where Nuxt builds the HTML and returns it. `/me` and everything under it is handled separately, because its content can depend on who is looking, and none of it is ever cached.

The app is small: a list of public notes (`/`), a page for each note (`/notes/:id`), and your own page (`/me`).

### How this differs from edge rendering

The HTML is built by a Lambda function in the Tokyo Region, not at a CloudFront edge location.

Because CloudFront stands in front, a response that is in the cache comes back from near the reader. A request that misses the cache travels to Tokyo, waits for Lambda to run, and travels back. A reader in London who opens an uncached page waits for the round trip to Tokyo.

Sitting behind a CDN does not mean running at the edge. This book calls the arrangement regional SSR. [Chapter 10](/en/chapters/10-edge.md) covers the code that can run at the edge and the limits it runs under.

### When you don't need SSR

SSR is not always better than a SPA. It adds a Lambda function, a cache you have to design, and more places that can fail.

- An app that shows nothing until you sign in has no HTML for a search engine to read, so the SPA from chapters 03 and 06 is enough
- A site whose content is fixed at build time can build all its HTML in advance and put it in S3, with no Lambda at all. This book's own site works that way

SSR helps with pages that are public, whose content is decided at request time, and where the first paint or the HTML a search engine sees matters.

## Shaping Nuxt for Lambda

<!-- section: 09.nitro -->

The server side of Nuxt is the work of a separate package called Nitro. Nitro has presets that change the shape of the build output to suit where it will run, and one of them targets AWS Lambda.

The versions are pinned. Nuxt is 4.6.1, and the Nitro it uses is `nitropack` 2.13.4. npm also carries a 3.x beta under the name `nitro`, but Nuxt 4.6.1 depends on the 2.x line, so 2.x is what I read. What follows comes from the source of the pinned `nitropack` (`dist/presets/aws-lambda/`) and from an actual build, not from documentation.

<<< @/examples/09-ssr/nuxt.config.ts{config}

The preset is named `aws-lambda` and has a single option, `awsLambda.streaming`. It applies only to `nuxt build`; `nuxt dev` does not use it.

The `import type {} from "@nuxt/nitro-server"` at the top is there for the type checker. Without it, the types in Nuxt 4.6.1 cannot tell which version of Nitro the contents of `nitro` belong to, and writing `preset` at all is a type error. With it, the object is checked against the types of the pinned `nitropack`, so a misspelled option name is caught.

A build produces this directory.

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

`server/` goes to Lambda as it is. Nitro collects the `node_modules` the server needs in there too, so CDK has nothing to bundle, unlike in chapter 04. `public/_nuxt/` holds the files that go to S3.

The `handler` that `index.mjs` exports comes in two shapes.

- With `streaming: false` (the default), `handler(event, context)` returns an object with `statusCode`, `headers`, `cookies`, and `body`. It builds the whole response before returning it
- With `streaming: true`, the handler is wrapped in `awslambda.streamifyResponse`, which the Lambda Node.js runtime provides, and writes the response to a stream

`nitro.json` records which shape was built. The CDK stack on [the next page](/en/chapters/09-ssr/build.md) reads that file to decide the matching setting on the Lambda side.

<<< @/examples/09-ssr/scripts/lambda-harness.ts{nitro-json}

Build output is another value that comes from outside the type system, so it is checked against a schema before use.

### Using Vize with Nuxt

Vize compiles, type-checks, and lints the `.vue` files, as it did in chapters 03 and 06. Adding `@vizejs/nuxt` 0.443.0 to `modules` makes both `nuxt dev` and `nuxt build` compile `.vue` files with Vize. Both ran on my machine.

Type checking and linting run outside Nuxt, with `vize check` and `vize lint` (the tasks `typecheck:ssr` and `lint:ssr`). For that reason the `.vue` files do not rely on Nuxt's auto-imports and import `useFetch` and the rest explicitly from `nuxt/app`. I have not checked how far Vize can follow types when auto-imports are used.

`@vizejs/nuxt` 0.443.0 depends on an old `@nuxt/kit` (3.11.2), so the install prints one peer dependency warning. It did not affect the build or the dev server.

## A small app

<!-- section: 09.app -->

The shape of a note is defined as a schema, the same way as in chapter 04.

<<< @/examples/09-ssr/core/notes.ts{note}

This is the list page.

<<< @/examples/09-ssr/app/pages/index.vue

While the server is building the HTML, `useFetch("/api/notes")` calls the route directly inside the same process and no HTTP is involved. When the same code runs in the browser, for example after you click a link and the view changes, it makes a real HTTP request. In both cases the returned value is checked against the schema before it is used.

`/api/notes` only returns the notes that ship with the code.

<<< @/examples/09-ssr/server/context.ts{context}

The notes are deliberately not read from DynamoDB. I wanted this chapter to depend only on chapters 03 and 04, and chapter 04 showed that data written into Lambda's memory cannot be the owner of anything. Read-only data that ships with the code gives the same answer from every execution environment. To read from the table of chapter 05 instead, replace the one line that sets `notes`.

`core/` holds only TypeScript that knows nothing about Nuxt or AWS. The decisions are written in `core/`, and the tests are written against `core/`. `server/` and `app/` are a thin layer that connects those decisions to Nuxt.
