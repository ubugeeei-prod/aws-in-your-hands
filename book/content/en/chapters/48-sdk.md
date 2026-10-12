---
title: "48 SDK: The AWS SDK for JavaScript v3, End to End"
sourceRevision: 1
---

# 48 SDK: The AWS SDK for JavaScript v3, End to End

Since chapter 01, every piece of code that calls AWS has been one line: `client.send(command)`. Inside that line the SDK looks for credentials, builds a request and signs it, sends it, waits and sends it again if that failed, and turns the answer into an object or an exception. Every stage has defaults, and the defaults were chosen so that things work without being written down, which is why you rarely think about them. You think about them when a function times out, or when there were more retries than you expected.

This chapter reads what is inside that line, from the source and types of the installed packages and from the official guides. What it reads, it then checks by connecting the real client to a small HTTP server on your machine. Nothing calls AWS. The number of retries, the waits, the timeouts, how pages are followed and how a waiter gives up are counted over real connections and pinned by tests. When an SDK upgrade changes a default, a test fails and tells you.

It builds on the credentials of [chapter 01](/en/chapters/01-account.md), and on chapters [04](/en/chapters/04-http-api.md), [05](/en/chapters/05-dynamodb.md) and [07](/en/chapters/07-uploads.md). Retries in general, meaning why backoff and jitter are needed and what a retry budget is, belong to [chapter 32](/en/chapters/32-limits.md). This chapter does not repeat that; it establishes only what the pinned SDK actually does. The code is in `examples/48-sdk/`. There is no CDK stack.

## The Whole Picture

<!-- section: 48.overview -->

```figure
caption: The order one send passes through. Everything below the retry loop runs again on every attempt
node app: Application code | client.send(command)
node early: initialize, serialize, build | Make an HTTP request from the input
node retry: retryMiddleware | Repeats attempts
node sign: httpSigningMiddleware | Signs
node log: attemptLogMiddleware | Added in this chapter
node deser: deserializerMiddleware | Turns the answer into output or an exception
node handler: Request handler | node:https, connection reuse
node endpoint: Service endpoint
edge app -> early
edge early -> retry
edge retry -> sign
edge sign -> log
edge log -> deser
edge deser -> handler
edge handler -> endpoint: HTTPS
mark retry
```

An SDK client holds an ordered list of functions called the middleware stack. When you call `send`, the input passes down the list, and at the bottom the request handler sends it over HTTP. The answer comes back up the same list. Names such as `retryMiddleware` in the figure are what the installed `DynamoDBClient` returned when asked for its list.

What matters most in the figure is where the retry middleware sits. Signing, reading the answer and sending are all below it, so a request is signed again on every attempt. Building the request body and fetching the credentials are above it, so they run once per `send`. The middleware that fetches credentials lives on the command's side of the stack, and the figure folds it into the second box from the top.

These are the packages this chapter reads, at the versions the rest of the book uses.

| Package | Version | What this chapter reads in it |
| --- | --- | --- |
| `@aws-sdk/client-dynamodb`, `@aws-sdk/client-s3` | 3.1149.0 | Clients, commands, exceptions, paginators, waiters |
| `@smithy/core` | 3.35.2 | The middleware stack, retries, error classification |
| `@smithy/node-http-handler` | 4.12.1 | Connections, timeouts |
| `@aws-sdk/credential-provider-node` | 3.972.85 | The order in which credentials are looked for |
| `@aws-sdk/lib-dynamodb`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner` | 3.1149.0 | Value conversion, uploads, presigned URLs |

The packages that start with `@smithy/` are what the SDK stands on. They are the runtime of Smithy, which the clients are generated from, and the parts that do not depend on a service, such as retries and sending HTTP, live there.

## A Client and a Command

<!-- section: 48.client-command -->

The v3 SDK is one package per service, and a call is written with two objects. A client holds configuration and connections; a command stands for one API operation and its input. This is where the chapter's script reads one note.

<<< @/examples/48-sdk/scripts/tour.ts{call}

A client holds the Region, where credentials come from, the retry settings, the request handler, and the middleware stack. It also holds one retry quota and one set of open connections. Make two clients and you have two quotas and two sets of connections, which the tests confirm. That is why a client is made once, outside the function's handler, and reused.

A command is a light object that carries the input. When it is handed to `send`, it joins the client's stack with its own and assembles the function to run. The same packages also export a class such as `DynamoDB` with every operation as a method, which this book does not use. The reason is bundle size, and [chapter 29](/en/chapters/29-lambda-tuning.md) measures it.

The second argument of `send` takes settings for that call alone. This chapter uses `abortSignal`.

## The Local Endpoint

<!-- section: 48.local-endpoint -->

To observe what the SDK does, you need something that gives known answers. So the chapter writes an HTTP server that listens on the loopback interface and points the client's `endpoint` at it. The client is the real one: signing, retries and connection handling run the same code as they do against AWS. Only the other side is different.

The server is this chapter's own. It is not DynamoDB and it is not S3. It has no table and no bucket, checks no signature, and answers what its script says. About the service's side, for example which error the real DynamoDB returns and when, it tells you nothing.

All it knows is the outer shape of two protocols. DynamoDB is sent JSON by POST, with the operation's name in the `x-amz-target` header, and reports an error as a status plus a code in the body's `__type`. S3 is REST with XML bodies.

<<< @/examples/48-sdk/src/local-endpoint.ts{answers}

A script is a function that receives a request and its position in the sequence, and returns an answer. `hang` accepts the request and returns nothing, which is how timeouts are tested. The server records each request and the number of the TCP connection that carried it.

<<< @/examples/48-sdk/src/local-endpoint.ts{endpoint}

The client is given the endpoint, a Region, and keys that are not real, all explicitly. With credentials given explicitly, the search for a source of credentials described on the next page never runs, so the tests do not depend on what is in `~/.aws` on this machine.

<<< @/examples/48-sdk/src/local-endpoint.ts{client-config}

On the pages that follow, "confirmed" means observed with the real client connected to this server. "Read in the source" means not observed: only the code of the installed package was read.

## When You Do Not Need This Chapter

<!-- section: 48.when-not -->

If you use D1 or R2 from Cloudflare Workers, most of this chapter does not apply. Cloudflare's documentation describes a binding as "a permission and an API in one piece", and says you never add secret keys or tokens to the Worker's code (checked on 2026-10-13). The order in which credentials are found, signing and endpoints never appear as things a developer decides. How much of retrying and timing out the platform takes on was not checked for this chapter.

On AWS the permission is in the execution role and the API is in the SDK. In exchange, for every call you can decide how many times to try, where to give up and which credentials to use, and where you do not decide, a default does. This chapter is for knowing those defaults.

If your app runs as chapter 05 left it and nothing is wrong, the sections on retries and timeouts in [Design and Build](/en/chapters/48-sdk/build.md) are enough. One fact there hurts if you learn it in production: a default client has no timeout at all.
