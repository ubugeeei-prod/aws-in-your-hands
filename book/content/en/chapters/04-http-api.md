---
title: "04 HTTP API: Lambda and API Gateway HTTP API"
sourceRevision: 4
---

# 04 HTTP API: Lambda and API Gateway HTTP API

The SPA is live. Next up: an API.

In this chapter you'll write a small HTTP API that creates, reads, and deletes notes. You'll run it on your machine first, then put the same code on Lambda. No Docker needed. And as long as you're only trying it locally, no AWS account either.

Two things before we start. This chapter's API keeps notes in memory and doesn't save them (saving is [chapter 05](/en/chapters/05-dynamodb.md)). There's no authentication either, so anyone who knows the URL can call it (authentication is [chapter 06](/en/chapters/06-auth.md)). To make up for that, it accepts at most 10 requests a second and holds at most 100 notes. Please don't put in anything you'd mind losing, or anything you'd mind other people seeing.

The only prerequisite is [chapter 02](/en/chapters/02-toolchain.md). The code is in `examples/04-http-api/`.

## The big picture

<!-- section: 04.architecture -->

```figure
caption: API Gateway passes only the requests that match a route to the Lambda function, and the function writes to CloudWatch Logs.
node client: Client | curl, typed client, later the SPA
node health: /health | GET
node notes: /notes | GET, POST
node note: /notes/{id} | GET, DELETE
node other: anything else | 404, Lambda is not invoked
node fn: Lambda function | Node.js 24, arm64, 256 MB, timeout 10 s
node logs: CloudWatch Logs | one JSON line per request, kept 7 days
edge client -> health: HTTPS
edge client -> notes
edge client -> note
edge client -> other
edge health -> fn
edge notes -> fn
edge note -> fn
edge fn -> logs: execution role: own log group only
group api: API Gateway HTTP API (ap-northeast-1) = health, notes, note, other
```

```figure
caption: Inside the Lambda function, the Hono app calls NoteService, and NoteService keeps the notes in a repository held in memory.
direction: right
node hono: Hono app
node service: NoteService
node repo: InMemoryNoteRepository | per execution environment
edge hono -> service
edge service -> repo
group fn: Lambda function = hono, service, repo
```

There are three players.

The front door is **API Gateway**. It accepts HTTPS and passes along only the requests that match a route you defined. Your code runs in **Lambda**. It starts up only when a request comes in, and goes back to waiting when it's done. There's no server that stays up. And the logs Lambda writes pile up in **CloudWatch Logs**.

Lambda runs inside the Tokyo Region. It isn't at the edge, the way CloudFront is.

### Which one is "HTTP API"?

API Gateway comes in several kinds, and the one we use here is the "HTTP API". The name is confusing, but think of it as a different product from the "REST API".

| | HTTP API | REST API |
| --- | --- | --- |
| Request price (Tokyo, first tier) | USD 1.29 per 1 million | USD 4.25 per 1 million |
| JWT authorizer | Yes | No (it has Cognito authorizers and Lambda authorizers) |
| AWS WAF, API keys, request validation, caching, X-Ray | No | Yes |
| Response streaming | No | Yes |

To borrow the official documentation's framing, an HTTP API is the one with fewer features at a lower price. All the notes API needs is routes and the JWT authorizer we'll use in chapter 06, so this one is enough.

On the other hand, if you want WAF right in front of the API, or you want to stream responses, it's time to choose again. The trick is not to blur the kinds together in your head, as in "API Gateway can't stream".

### When Lambda isn't the right fit

What's nice about Lambda is that it costs 0 while nobody is using it, and that you can add one API without designing a network. There are cases where it doesn't fit, though.

- One unit of work takes more than 30 seconds. An HTTP API waits at most 30 seconds for Lambda's response ([chapter 08](/en/chapters/08-async.md) and [chapter 16](/en/chapters/16-long-jobs.md))
- You need connections that stay open, or you want to run a container you already have as it is ([chapter 12](/en/chapters/12-containers.md))
- You want to run right next to the reader ([chapter 10](/en/chapters/10-edge.md))

## Start with the contract

<!-- section: 04.contract -->

Before writing any code, let's turn the shapes of the API's input and output into schemas.

<<< @/examples/04-http-api/src/contract.ts{note}

Both the server and the client use this definition. The server validates incoming requests with it, and the client validates the responses it gets back with it. The TypeScript types come from here too, through `z.infer`. Since there's only one definition, "I fixed the server and forgot the client" can't happen.

Let's settle the shape of errors as well.

<<< @/examples/04-http-api/src/contract.ts{error}

The caller can branch on `code` without having to interpret the wording of a message. `requestId` is your lead when you go looking through the logs later.

## Write the app

<!-- section: 04.app -->

For HTTP handling we'll use Hono. It's a small framework built on the web-standard `Request` and `Response`, so the same app runs as is on Node.js and on Lambda. Plenty of you have probably used it on Workers.

<<< @/examples/04-http-api/src/app.ts{app}

Three things to notice.

**Everything it needs comes in as an argument.** The clock, the ID generator, where logs go, where notes are stored. Inside `createApp`, nothing touches `Date.now()` or `process.env` directly. A test can pass fixed values, and production can pass the real thing.

**Requests get checked at run time.** TypeScript types are gone by the time the code runs. You can't say "the type is `CreateNote`, so it's fine". `validator` runs the JSON that arrived through the schema, and if it doesn't match, returns a 400 that says which fields are the problem.

**Unexpected exceptions don't leak their cause.** `onError` writes to the log and gives the caller only the `requestId`. Putting a stack trace in the response would tell people how the inside is built.

Where notes are stored is an interface.

<<< @/examples/04-http-api/src/notes.ts{repository}

Right now what's behind it is a plain `Map`. A `Map` is memory, and on an API anyone can `POST` to, it grows by whatever it's handed. So it stops at 100 notes: note 101 throws `NoteLimitError`, and the app's `onError` turns that into a 409 with `quota_exceeded`. Not a 429, because waiting doesn't free a place. Deleting a note does, hence the 409.

Chapter 05 swaps in DynamoDB, but this interface stays as it is.

And the real clock, real random numbers, and real environment variables are touched in this one place only.

<<< @/examples/04-http-api/src/compose.ts{compose}

## Check the configuration at startup

<!-- section: 04.env -->

Environment variables are values that come from outside the type system, too. The type of `process.env` is "everything is `string` or `undefined`". Looking at the type won't tell you whether a required variable is actually set.

<<< @/examples/04-http-api/src/env.ts{env}

The check happens once, at startup. If something is missing, the first invocation fails with a message that names the variable. That's a lot easier to find than "it reads `undefined` and breaks only under certain conditions", isn't it?

By the way, what lives here is configuration, not secrets. Lambda environment variables can be read by anyone who can see the function's configuration in the console. Secrets such as API keys don't go directly into environment variables; you fetch them at run time from Secrets Manager or something like it. This chapter's example has no secrets, so that code isn't in this chapter ([chapter 21](/en/chapters/21-security.md) covers it).
