---
title: "04 HTTP API: Lambda and API Gateway HTTP API"
sourceRevision: 7
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
caption: Inside the Lambda function, the app calls NoteService, and NoteService keeps the notes in a repository held in memory.
direction: right
node app: App | Request in, Response out
node service: NoteService
node repo: InMemoryNoteRepository | per execution environment
edge app -> service
edge service -> repo
group fn: Lambda function = app, service, repo
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

The schemas are written with Valibot, a library that builds a schema out of small functions such as `v.string()`. `v.pipe` runs the checks and transformations it is given in the order they are written. For `title` in `createNoteSchema`, that means checking that the value is a string, trimming the whitespace around it with `v.trim()`, and then checking that its length is between 1 and 120 characters. The second argument of `v.optional` is the value to use when the field is absent.

The check on `createdAt` is the one written by hand.

<<< @/examples/04-http-api/src/timestamp.ts{timestamp}

Valibot's `v.isoTimestamp()` takes an offset such as `+09:00`, a space in place of the `T`, and February 30. A stored time is read back later, compared, and subtracted, so the book settles on one spelling. The check accepts the form that `toISOString()` of a `Date` writes (UTC, ending in `Z`), and the same form without the milliseconds. Nothing else. This is not the only built-in check that is looser than it looks, and later chapters add a check of their own wherever the difference matters.

The server and the client use this one definition. The server validates incoming requests against it, and the client validates the responses it gets back. The TypeScript types come from it too, through `v.InferOutput`. With a single definition, you can't fix the server and forget the client.

The shape of a list is decided separately from the shape of one note.

<<< @/examples/04-http-api/src/contract.ts{list}

A list carries the ID, the title, and the creation time, and leaves the body out. When you need the body, you fetch one note with `GET /notes/:id`. The list also stops at the newest 20 notes. A body can hold 10,000 characters, so returning every note with its body would make a single response several MB. With summaries only, and 20 at most, the response stays under 20 KiB whatever the titles contain. `list` in `createNoteService` does the cutting. `v.object` silently drops fields the schema doesn't define, while `v.strictObject`, which the list schema uses, fails when it meets one. So a response that lets a body through fails the client's validation.

Notes older than the newest 20 no longer appear in the list, but you can still read or delete one if you know its ID. Chapter 05 adds a way to fetch the rest of a list.

The shape of an error is fixed as well.

<<< @/examples/04-http-api/src/contract.ts{error}

The caller can branch on `code` without interpreting the wording of a message. `requestId` is what you search the logs for later.
