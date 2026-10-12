---
title: "04 HTTP API: Lambda and API Gateway HTTP API"
sourceRevision: 5
---

# 04 HTTP API: Lambda and API Gateway HTTP API

Chapter 03 put the SPA online, and this chapter builds an API. You write a small HTTP API that creates, reads, and deletes notes, run it on your machine, and then put the same code on Lambda. Docker isn't used, and as long as you only run it locally you don't need an AWS account either.

This chapter's API has two gaps that later chapters fill. Notes are kept in memory and not saved, so they vanish when the execution environment is replaced ([chapter 05](/en/chapters/05-dynamodb.md) adds storage). There is no authentication, so anyone who knows the URL can call it ([chapter 06](/en/chapters/06-auth.md) adds that). To limit the damage, the API accepts at most 10 requests a second, holds at most 100 notes, and lists at most the newest 20 of them as summaries. Don't put in anything you would mind losing or mind other people seeing.

The only prerequisite is [chapter 02](/en/chapters/02-toolchain.md). The code is in `examples/04-http-api/`.

## The big picture

<!-- section: 04.architecture -->

```figure
caption: API Gateway passes only the requests that match a route to the Lambda function, and the function writes its logs to CloudWatch Logs.
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

Three services are involved. API Gateway is the entry point: it accepts HTTPS and passes on to Lambda only the requests that match a route you defined. Lambda is where your code runs. It starts when a request arrives and goes back to waiting when the request is done, so no server stays up. The logs Lambda writes collect in CloudWatch Logs.

Lambda runs inside the Tokyo Region, not at the edge the way CloudFront does.

### HTTP API and REST API

API Gateway comes in several kinds, and this chapter uses the one called "HTTP API". It looks like a general term, but it is a product name, and it is a different product from API Gateway's "REST API".

| | HTTP API | REST API |
| --- | --- | --- |
| Request price (Tokyo, first tier) | USD 1.29 per 1 million | USD 4.25 per 1 million |
| JWT authorizer | Yes | No (it has Cognito authorizers and Lambda authorizers) |
| AWS WAF, API keys, request validation, caching, X-Ray | No | Yes |
| Response streaming | No | Yes |

The official documentation describes HTTP APIs as the kind with fewer features and a lower price. The notes API needs little more than routes and the JWT authorizer that chapter 06 uses, so an HTTP API is enough.

If you want AWS WAF directly in front of the API, or want to stream responses, choose a REST API instead. The kind that can't stream is the HTTP API, not API Gateway as a whole, and keeping the two apart makes that later choice easier.

### Where Lambda doesn't fit

Lambda costs 0 while nobody uses it, and you can add an API without designing a network. It is a poor fit in these cases.

- One unit of work takes more than 30 seconds. An HTTP API waits at most 30 seconds for Lambda's response ([chapter 08](/en/chapters/08-async.md) and [chapter 16](/en/chapters/16-long-jobs.md))
- You need connections that stay open, or you want to run a container you already have as it is ([chapter 12](/en/chapters/12-containers.md))
- You want the code to run close to each user ([chapter 10](/en/chapters/10-edge.md))

## Decide the contract first

<!-- section: 04.contract -->

Before writing any code, write the shapes of the API's input and output as schemas.

<<< @/examples/04-http-api/src/contract.ts{note}

The server and the client use this one definition. The server validates incoming requests against it, and the client validates the responses it gets back. The TypeScript types come from it too, through `z.infer`. With a single definition, you can't fix the server and forget the client.

The shape of a list is decided separately from the shape of one note.

<<< @/examples/04-http-api/src/contract.ts{list}

A list carries the ID, the title, and the creation time, and leaves the body out. When you need the body, you fetch one note with `GET /notes/:id`. The list also stops at the newest 20 notes. A body can hold 10,000 characters, so returning every note with its body would make a single response several MB. With summaries only, and 20 at most, the response stays under 20 KiB whatever the titles contain. `list` in `createNoteService` does the cutting, and because the schema is strict, a response that lets a body through fails the client's validation.

Notes older than the newest 20 no longer appear in the list, but you can still read or delete one if you know its ID. Chapter 05 adds a way to fetch the rest of a list.

The shape of an error is fixed as well.

<<< @/examples/04-http-api/src/contract.ts{error}

The caller can branch on `code` without interpreting the wording of a message. `requestId` is what you search the logs for later.

## Write the app

<!-- section: 04.app -->

HTTP handling uses Hono, a small framework built on the web-standard `Request` and `Response`, so the same app runs unchanged on Node.js and on Lambda. You may have used it on Workers.

<<< @/examples/04-http-api/src/app.ts{app}

The app receives everything it needs as arguments: the clock, the ID generator, where logs go, and where notes are stored. Nothing inside `createApp` touches `Date.now()` or `process.env` directly, so a test can pass fixed values and production can pass the real ones.

Requests are checked at run time. TypeScript types are gone by the time the code runs, so a parameter typed `CreateNote` says nothing about the JSON that actually arrived. `validator` checks that JSON against the schema and, when it doesn't match, returns a 400 that names the fields at fault.

An unexpected exception doesn't leak its cause. `onError` writes it to the log and gives the caller only the `requestId`, because a stack trace in the response would show outsiders how the app is built inside.

The place notes are stored is an interface.

<<< @/examples/04-http-api/src/notes.ts{repository}

The implementation today is a plain `Map`. A `Map` lives in memory, and on an API anyone can `POST` to, it grows by whatever it is handed. So it stops at 100 notes, and the 101st throws `NoteLimitError`, which the app's `onError` turns into a 409 with `quota_exceeded`. The status is 409 and not 429 because waiting doesn't free a place and deleting a note does.

Chapter 05 replaces the store with DynamoDB and keeps this interface as it is.

The real clock, real random numbers, and real environment variables are touched in one place only.

<<< @/examples/04-http-api/src/compose.ts{compose}

## Check the configuration at startup

<!-- section: 04.env -->

Environment variables also come from outside the type system. The type of `process.env` says only that every variable is `string` or `undefined`, so it can't tell you whether a required one is set.

<<< @/examples/04-http-api/src/env.ts{env}

The variables are checked once, at startup. If one is missing, the first invocation fails with a message that names it. That leads you to the cause much sooner than code that reads `undefined` and breaks only under certain conditions.

What is kept here is configuration, not secrets. Anyone who can see the function's configuration in the console can read a Lambda environment variable. Secrets such as API keys don't go into environment variables directly. You fetch them at run time from Secrets Manager or a similar service. This chapter's example has no secrets, so it has no code for that ([chapter 21](/en/chapters/21-security.md) covers it).
