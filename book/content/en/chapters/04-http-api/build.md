---
title: "04 HTTP API: Design and Build"
---

# 04 HTTP API: Design and Build

The [previous page](/en/chapters/04-http-api.md) settled the shapes of the API as schemas. This page implements what happens between a request arriving and a response going back, in the order it happens.

## Write the app

<!-- section: 04.app -->

This book handles HTTP without a framework. The app is one function that takes a `Request` and returns a `Response`.

<<< @/examples/04-http-api/src/http/router.ts{handler}

`Request` and `Response` are the web-standard types a browser's `fetch` uses. Node.js and Workers have the same types, so an app written in this shape runs the same way on Lambda and behind a Node.js server on your machine.

A framework would take care of routing, CORS, and translating Lambda's event. This chapter writes them by hand because, for someone new to AWS, what happens inside those parts is the thing most worth seeing: what Lambda hands a function, how a route is chosen, how much of a body is read. The code is in five files under `src/http/`, about 300 lines in all, and the rest of this section follows a request through them. The price is that it does less than a widely used framework, and nothing has tested it but this book's tests. Each part below says what it leaves out.

### Turning Lambda's event into a Request

Lambda doesn't hand a function a `Request`. It hands it a JSON object in which API Gateway has written down the HTTP request. This function builds a `Request` back out of that event.

<<< @/examples/04-http-api/src/http/api-gateway.ts{to-request}

The URL is the event's domain name, the path as it was sent, and the query string, joined together. When a header appeared more than once, API Gateway has already joined the values with commas. Cookies are the exception: they arrive in an array apart from the headers, so the function puts them back into one `cookie` header. The body arrives as a string, and bytes that aren't text arrive as base64, so the function looks at `isBase64Encoded` and decodes them.

The function reads only events in the HTTP API's payload format version 2.0. A REST API's event has a different shape, and this function can't read it.

### Choosing a route

<<< @/examples/04-http-api/src/http/router.ts{router}

`route` ties a method, a path, and the code that answers into one entry. The path is a `URLPattern` pattern: `/notes/:id` matches `/notes/abc` and gives `abc` the name `id`. `URLPattern` is another web-standard API that browsers share, and Node.js 24 has it as a global.

`router` tries the routes in the order they are written and lets the first one whose method and path both match answer. If none matches, `notFound` answers. `URLPattern` returns the parts of the path as they were sent, so `decode` undoes encodings such as `%20`. A sequence that can't be decoded is treated as matching no route.

That is all the router does. It doesn't answer 405 when the path matches and the method doesn't, and it doesn't treat `HEAD` as `GET`, so both get a 404.

### Reading the body and checking it

<<< @/examples/04-http-api/src/http/body.ts{read-json}

`readJson` never reads a body past the limit. It looks at the `content-length` header first and refuses without reading when the header is over the limit. The header can be missing, or can state less than what follows, so the function also counts bytes as it reads and stops once the count passes the limit. When the body has been read, it is decoded as UTF-8 and parsed as JSON. If either step fails, or the body is empty, the result is `invalid_json`. The function doesn't look at the `content-type` header, so a body labeled `text/plain` is accepted as long as it parses as JSON.

On Lambda the whole body has already arrived inside the event, so stopping early saves no memory there. Counting while reading pays off where the body arrives as a stream, as it does on the local server.

These are the five routes.

<<< @/examples/04-http-api/src/app.ts{routes}

`POST /notes` gives `readJson` a limit of 64 KiB and answers 413 when the body is larger and 400 when it isn't JSON.

A body that parses as JSON isn't necessarily a note. TypeScript types are gone by the time the code runs, so the value `readJson` returns is typed `unknown`. `v.safeParse` checks it against the contract's schema, and when it matches, `input.output` holds a value typed `CreateNote`, with the title trimmed and an empty string for a missing body. When it doesn't match, `input.issues` lists the reasons. `v.getDotPath` gives the field each one is about, and the route returns them with a 400.

### CORS

A browser doesn't let a page on one origin read a response from an API on another origin unless the API attaches headers that allow it. `cors` attaches them.

<<< @/examples/04-http-api/src/http/cors.ts{cors}

`cors` takes the handler to call next and returns a handler of the same shape. The next section shows what `createApp` wraps in it.

Before a request such as a `POST` whose `content-type` is `application/json`, a browser asks permission with an `OPTIONS` request, called a preflight. `cors` answers the preflight itself, so no route sees it. Every other request goes on to the next handler, and `cors` puts `access-control-allow-origin` on a copy of the response that comes back.

One origin is allowed, the one in the `ALLOWED_ORIGIN` environment variable, and the value doesn't depend on who is calling. A page on another origin receives the same value, and its browser withholds the response because the value isn't that page's origin. The function can't allow several origins, and it can't allow requests that carry cookies.

### What happens to every request

<<< @/examples/04-http-api/src/app.ts{around}

The rest of `createApp` is what happens to every request. Where a framework would split the work into middleware, this code nests functions. The innermost one, `caught`, catches an exception a route throws and turns it into an error of the usual shape. `cors` wraps `caught`, and the outermost function makes an ID for the request, sets the `x-request-id` header, and writes one log line. Values the routes should see travel in `context`, which in this chapter holds only `requestId`.

The order of the wrapping has a reason. `caught` sits inside `cors`, so a 409 or a 500 carries `access-control-allow-origin` too. Without it a browser would keep the error response from the page, and the page couldn't show what went wrong.

An unexpected exception doesn't leak its cause. `caught` writes it to the log and gives the caller only the `requestId`, because a stack trace in the response would show outsiders how the app is built inside.

### Turning the Response into Lambda's result

What Lambda takes back from a function is also a JSON object.

<<< @/examples/04-http-api/src/http/api-gateway.ts{to-result}

`toResult` moves the status code, the headers, and the body of a `Response` into that shape. `set-cookie` headers can't be merged into one, so they go into the `cookies` array. Because the result is JSON, a body that isn't text is sent as base64 with `isBase64Encoded` set. The body is read to the end before anything is returned, so a response can't be sent piece by piece.

<<< @/examples/04-http-api/src/http/api-gateway.ts{handle}

`handleApiGateway` puts a handler between those two translations. It also passes the event itself as `context`, for what a `Request` can't carry, such as what API Gateway verified. This chapter's app doesn't use it, and chapter 06 does. `src/lambda.ts`, the entry point on Lambda, appears in [Where the notes live](/en/chapters/04-http-api/local.md).

### What is passed in

`createApp` receives everything it needs as arguments: the clock, the ID generator, where logs go, and where notes are stored. Nothing inside `createApp` touches `Date.now()` or `process.env` directly, so a test can pass fixed values and production can pass the real ones.

The place notes are stored is an interface.

<<< @/examples/04-http-api/src/notes.ts{repository}

The implementation today is a plain `Map`. A `Map` lives in memory, and on an API anyone can `POST` to, it grows by whatever it is handed. So it stops at 100 notes, and the 101st throws `NoteLimitError`, which `caught` turns into a 409 with `quota_exceeded`. The status is 409 and not 429 because waiting doesn't free a place and deleting a note does.

Chapter 05 replaces the store with DynamoDB and keeps this interface as it is.

The real clock, real random numbers, and real environment variables are touched in one place only.

<<< @/examples/04-http-api/src/compose.ts{compose}

## Check the configuration at startup

<!-- section: 04.env -->

Environment variables also come from outside the type system. The type of `process.env` says only that every variable is `string` or `undefined`, so it can't tell you whether a required one is set.

<<< @/examples/04-http-api/src/env.ts{env}

The variables are checked once, at startup. If one is missing, the first invocation fails with a message that names it. That leads you to the cause much sooner than code that reads `undefined` and breaks only under certain conditions.

What is kept here is configuration, not secrets. Anyone who can see the function's configuration in the console can read a Lambda environment variable. Secrets such as API keys don't go into environment variables directly. You fetch them at run time from Secrets Manager or a similar service. This chapter's example has no secrets, so it has no code for that ([chapter 21](/en/chapters/21-security.md) covers it).
