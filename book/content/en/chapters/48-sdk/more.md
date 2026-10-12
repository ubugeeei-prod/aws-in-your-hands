---
title: "48 SDK: Build, Continued"
---

# 48 SDK: Build, Continued

The [previous page](/en/chapters/48-sdk/build.md) read what is inside one call. This page covers the parts that string calls together and the ways data goes in and out: paginators and waiters, streams, presigned URLs, the conversion of DynamoDB values, and how to write tests.

## Paginators and Waiters

<!-- section: 48.pages-waiters -->

An operation that returns a list hands back a value that points at the rest when one answer cannot hold it all. For DynamoDB's Scan and Query that is `LastEvaluatedKey`, which goes into `ExclusiveStartKey` of the next request. A paginator wraps that hand-over in an async iterator. There is one per operation, such as `paginateScan` and `paginateQuery`.

A paginator has no limit. It keeps asking until the service stops returning a value to continue from. A `for await` over a Scan of a large table reads the table from end to end, and what it reads is billed. So the chapter wraps it with a limit on pages.

<<< @/examples/48-sdk/src/pages.ts{pages}

Leaving the loop is enough to stop the requests, because a paginator sends nothing until it is asked for the next page. Against a script for a table of 1,000 pages, with the limit at 4, four requests arrived.

For DynamoDB, `pageSize` is sent as `Limit`. Chapter 05's repository does not use a paginator: it returns one page at a time with `Limit` and a cursor of its own. When the API itself returns a page at a time, that is the more direct way. A paginator fits a batch or a script, where one piece of work reads through to the end.

A waiter keeps asking, at intervals, until a resource reaches the wanted state. `waitUntilTableExists` repeats `DescribeTable` and returns once the table is `ACTIVE`. You give it the longest it may wait (`maxWaitTime`, in seconds). The interval starts at `minDelay` and grows towards `maxDelay`, with jitter. For this DynamoDB waiter the defaults were 20 and 120 seconds.

Past the limit it ends with `TimeoutError`; cut off by `abortSignal`, with `AbortError`. Both are told apart by `name`.

What you should know is that this waiter **reads every exception as "not yet"**. Waiting through `ResourceNotFoundException` while the table does not exist is expected, but the source treats any other exception the same way. Against a script that keeps answering `AccessDeniedException` for a missing permission, the waiter did not give up after one answer: it kept asking until `maxWaitTime` ran out and ended with `TimeoutError`. The cause is a permission, and what you see is a timeout. The SDK does warn after 60 seconds when 403s keep coming, but that does not catch a permission error returned with status 400, as here. When a waiter times out, first call the same operation once, directly, and look at the exception.

## Streams

<!-- section: 48.streams -->

The `Body` of S3's `GetObject` is a stream, not bytes. In Node.js it is a Node.js stream and in a browser a web stream, and on both the SDK adds three methods: `transformToString()`, `transformToByteArray()` and `transformToWebStream()`.

These methods can be called once, because a stream cannot be rewound. A test confirms that a second `transformToString()` throws.

The SDK's documentation warns about one more thing. Connections are reused, so until `Body` is read to the end or destroyed, its connection does not become free. Code that looks at the headers and leaves `Body` alone ties up connections one at a time. If you do not need the contents, use `HeadObject`.

`transformToString()` reads the whole object into memory. How large an attachment is was decided by whoever uploaded it, not by the reader. So the chapter has a function that reads with a ceiling.

<<< @/examples/48-sdk/src/body.ts{read}

Past the ceiling it cancels the stream. Cancelling closes the connection, so nothing stays tied up. A test reads a 100,000-byte object with a ceiling of 1,024 bytes, is refused, and confirms that the same client's next call goes through.

Passing a large object straight on from Lambda to its caller takes the same shape as the response streaming of [chapter 17](/en/chapters/17-ai.md), and is not covered here.

### Large Uploads

On the sending side, `Upload` from `@aws-sdk/lib-storage` splits a large body into parts and sends them in parallel. It assembles the multipart upload that chapter 07 mentioned only by name.

By default a part is 5 MiB and four parts are sent at a time. A body that fits in one part is sent as a single `PutObject`, not as a multipart upload. Against the local endpoint, a body of exactly 5 MiB was one `PutObject`, and one byte more became four requests: `CreateMultipartUpload`, two `UploadPart`, and `CompleteMultipartUpload`. The completing request lists the parts in order of their numbers.

When a part does not get through even with retries, `Upload` sends `AbortMultipartUpload`. With a script that answers 500 for part 2 only, a test confirms that the aborting request arrived and the completing one did not. As chapter 07 said, parts that were neither completed nor aborted go on being billed, so leave this default (`leavePartsOnError: false`) alone. The aborting request itself may fail to arrive, so the lifecycle rule in chapter 07's stack that aborts incomplete multipart uploads is still needed when you use `Upload`.

Chapter 07's app sends from the browser straight to S3, so it has no use for `Upload` on the server. You use it when a Lambda function or an ECS task makes a file itself and puts it in S3.

## Presigned URLs

<!-- section: 48.presign -->

[Chapter 07](/en/chapters/07-uploads.md) used presigned URLs. Seen from the SDK, a presigned URL is a request that was signed and not sent. `getSignedUrl` passes the command through the middleware stack to make an HTTP request, puts the signature in the URL's query, and returns it. It sends nothing: making a URL with a client pointed at the local endpoint, not one request arrived.

With nothing specified, it lasts 900 seconds.

The URL contains the ID of the key that signed it (`X-Amz-Credential`). Signed with temporary credentials, it also contains the session token (`X-Amz-Security-Token`). The URL is a power of attorney issued in the name of those credentials. The S3 documentation says a presigned URL expires at the time you configured or when the credentials that signed it expire, whichever comes first.

So the same `expiresIn: 3600` lasts differently depending on where it was signed. The credentials of a Lambda execution role are temporary, so a URL you meant to last an hour can expire sooner. How much life the credentials have left when a function receives them was not checked for this chapter. A URL signed with an IAM user's long-term key is valid until the time you specified. The documentation adds that if the key is deactivated or deleted, the URL expires there and then.

The time left can be checked before signing: the credentials returned by the client's `config.credentials()` have an `expiration`. If you need a long-lived URL, look at that value, issue a shorter one when there is not enough left, and build the app so that it can fetch another when one expires. Chapter 07 keeps the lifetime at 5 minutes, which keeps this effect small.

A URL expiring because its credentials expired, against the real S3, was not confirmed for this chapter. It is what the documentation says.

Something else turned up with the presigned URL of `PutObject`. Made with the pinned version, the URL contains `x-amz-sdk-checksum-algorithm=CRC32` and `x-amz-checksum-crc32=AAAAAA==`. The second is the checksum of a body of zero bytes: at signing time there is no body, so it is computed as empty. How S3 answers when a real body is PUT to that URL was not checked. Chapter 07 uploads with a POST that can carry conditions, not with a `PutObject` URL, and so does not meet this.

## Converting DynamoDB Values

<!-- section: 48.marshalling -->

DynamoDB's API passes values with their types. A string is `{ "S": "a" }` and a number is `{ "N": "1" }`. The document client of `@aws-sdk/lib-dynamodb`, in use since chapter 05, converts between JavaScript values and that form on the way out and on the way in. The conversion is called marshalling.

The document client is a wrapper around the base client. Retries and connections are the base client's.

The rules of the conversion are written down as configuration. Every value is what the pinned version does with nothing specified.

<<< @/examples/48-sdk/src/document.ts{translate}

What becomes what was confirmed from the bodies that arrived at the local endpoint.

| JavaScript value | What is sent |
| --- | --- |
| String, number, boolean, `null` | `S`, `N`, `BOOL`, `NULL` |
| Array, object | `L`, `M` |
| `Set` of strings, `Set` of numbers | `SS`, `NS` |
| `Uint8Array` | `B` |
| `bigint` | `N` |
| Empty string | `S` with an empty string |

Some values are refused. Each throws before anything is sent.

| Value | Result |
| --- | --- |
| `undefined` inside a map or a list | Throws, pointing at `removeUndefinedValues` |
| An empty `Set` | Throws |
| A `Date`, a class instance | Throws, pointing at `convertClassInstanceToMap` |
| A number of 2 to the 53rd or more | Throws, pointing at `NumberValue` |
| `NaN`, `Infinity` | Throws |

Before following a pointer, know what it does. With `convertClassInstanceToMap` on, a `Date` is stored as an empty map. The time is gone. That is why chapter 05 keeps times as ISO 8601 strings.

One thing is dropped without a word. An attribute that is `undefined` directly on the item does not throw and is not sent. The documentation says an item is not itself considered a map. Putting `{ pk: "a", title: undefined }`, only `pk` arrived. A Put replaces the whole item, so an item that had a `title` loses it. Sometimes that is what you meant, but keep it in mind if you use types with optional fields from a Valibot schema.

On the reading side, numbers are the issue. An `N` arrives as a string of digits, so it can hold a value that a JavaScript `number` cannot. These are the results that were confirmed.

| Stored `N` | Value received |
| --- | --- |
| `1`, `1.5` | `number` |
| `9007199254740993` | `bigint` |
| `1.00000000000000000001` | the `number` `1` |

A large integer becomes a `bigint`. `JSON.stringify` throws on a `bigint`, so putting one straight into an API response is a 500. A decimal with many digits is rounded without a word. Neither happens in this book's notes app, whose only numbers are a count and a version. If you keep amounts of money or external IDs in an `N`, set `wrapNumbers: true` and receive numbers as `NumberValue`, which holds the digits as a string. On the writing side you can pass `NumberValue.from("…")`.

## Bundles and Reusing a Client

<!-- section: 48.bundle -->

The v3 SDK is split by service and by command so that only what you use goes into the bundle. How much each way of writing changes it, and why esbuild's `mainFields` matters, is measured in [chapter 29](/en/chapters/29-lambda-tuning.md). Nothing was measured here.

What this chapter adds is the reasons to have one client, and three have come up. Connections belong to a client, so making a new one starts the connections over. The retry quota belongs to a client too, so a client made on every call always has a full quota and never holds retries down during an outage. And the client is what remembers the credentials.

The SDK's README also recommends one client per service and Region on Lambda, made outside the handler. Chapter 05's `compose.ts` has done so from the start.

## Tests

<!-- section: 48.testing -->

For code that uses the SDK, there are three places to put a fake.

The outermost is an interface of your own. Chapter 05's `NoteRepository` is one, and the app's tests run against an in-memory implementation. What those tests check is the app's decisions, and no SDK command appears in them. This book writes most of its tests this way because the invariants it wants to keep are stated in the app's terms. "At most 100 notes" is something to check as the repository's promise, not as the `ConditionExpression` of an `UpdateCommand`.

One layer in is the client's `send`: replace it and inspect the command it was given. `aws-sdk-client-mock` is a library for this layer. On the npm registry, as of 2026-10-13, its latest version is 4.1.0, published on 2024-10-15, and it is not deprecated. It depends on sinon. That makes two years without a new version. Whether it works with the pinned SDK was not tried. Tests at this layer suit checking that a repository's implementation built a command with the right arguments. But they confirm only that it was sent so, not that the service accepts it. Chapter 05 covers this layer with tests against DynamoDB Local.

The innermost is HTTP. Chapter 32 swapped `requestHandler` for a fake, and this chapter connected the real handler to a local server. Only at this layer can the SDK's own behaviour, meaning retries, timeouts and connections, be confirmed. Writing an app's tests here is not recommended. You would be writing answers by hand in the protocol's form, and nobody guarantees that the form matches the real thing. This chapter's scripts, too, return only the few fields the SDK reads.

The tests of this chapter take one more precaution. The SDK reads environment variables and the settings in `~/.aws`. A `max_attempts` or an `AWS_PROFILE` on a developer's machine would change the result of a test that checks defaults. So each test file begins by removing the environment variables that start with `AWS_` and pointing the config files at temporary ones. The tests of the defaults go further and run in a separate process.
