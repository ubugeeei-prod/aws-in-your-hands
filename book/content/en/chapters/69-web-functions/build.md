---
title: "69 Web Functions: Design and Build"
---

# 69 Web Functions: Design and Build

The [first page](/en/chapters/69-web-functions.md) showed the notes API of chapter 04 becoming a Web Function with no adapter. This page reads, in order, how a Web Function differs from an Event Function and from a container, how the server starts and stops, how requests in flight together are kept apart, the finer rules of HTTP, and the stack.

## Event Function, Web Function, container

<!-- section: 69.model -->

This book has already run an HTTP API on AWS in two shapes: the Event Function behind an HTTP API in [chapter 04](/en/chapters/04-http-api.md), and the Fargate container behind an ALB in [chapter 12](/en/chapters/12-containers.md). A Web Function is close to the container in the shape of its code, and close to the Event Function in how it is billed and operated.

| | Event Function and HTTP API | Web Function | Fargate container |
| --- | --- | --- | --- |
| Shape of the code | A handler that takes an event | A server listening on a port | A server listening on a port |
| HTTP entry point | API Gateway | Endpoint | ALB |
| Requests one environment takes at once | 1 | 64 by default, 128 at most | Up to the app |
| With no requests | No environments | No environments | Tasks keep running |
| What is billed | Requests and duration | Requests, CPU time, memory while an environment exists | Time the tasks run |
| Unit of deployment | Versions and aliases | Revisions and endpoint weights | Task definitions and services |

What leaves chapter 04 is API Gateway and the adapter in `src/http/api-gateway.ts`. Of the work API Gateway did, throttling passes to the endpoint's `rateLimit`. Answering the CORS preflight stays with the app, because Lambda adds nothing. The chapter 04 app already answered it itself, so the code does not change. A custom domain, a WAF, and a cache come from putting CloudFront in front of the endpoint.

What arrives is revisions and endpoints. With an Event Function, a change to the function's configuration took effect on the spot, and being able to go back meant setting up versions and aliases yourself ([chapter 31](/en/chapters/31-progressive-delivery.md)). With a Web Function, any change to code or configuration creates a new revision, and the endpoint holds which revisions get the requests. The place to go back to is there from the start. In exchange, there is no such operation as changing one setting. A new revision inherits nothing from the one before, so the environment variables and the timeout are written out every time.

In how you write the program, one thing changes. A handler dealt with one event each time it was called and was done. A server, once started, keeps running and deals with several requests at once.

## Starting the server, and stopping it

<!-- section: 69.server -->

Three things are agreed between Lambda and the server: the address, the deadline for starting, and the signal to stop.

```figure
caption: The life of an execution environment. Lambda learns of the start from an accepted connection, and announces the end with SIGTERM
type: sequence
actor lambda: Lambda
actor server: Server process
step lambda -> server: start, pass the address
step server -> server: listen
step lambda -> server: can it connect? (10 s)
note server: Ready
step lambda -> server: requests (several at once)
step lambda -> server: SIGTERM
step server -> server: exit within 1 s
```

Lambda chooses the address and puts it in `AWS_LAMBDA_HTTP_ENDPOINT` as `host:port`. A revision's environment variables cannot set this variable. If the server listens on another host or port, no request arrives, and the first request gets a 502.

<<< @/examples/69-web-functions/src/listen.ts{listen}

`127.0.0.1:8787` is used only when the variable is absent, for running on your own machine. When there is a value that cannot be read, the process stops instead of falling back. Starting on the default address would look to Lambda exactly like a failed start, and the cause would be harder to see.

The deadline for starting is 10 seconds. Lambda loads the code, starts the process, and makes the environment Ready once it can connect to that address. `serve` returns after the socket accepts connections.

<<< @/examples/69-web-functions/src/serve.ts{serve}

One thing to remember here: Lambda does not check that the server starts, neither when it creates a revision nor when it updates an endpoint. With the revision and the endpoint both Active, a wrong name for the entry file still fails only at the first request. That is why every deployment needs one request sent to it.

Stopping begins with SIGTERM. When Lambda removes an execution environment, it first stops sending requests to it, waits as far as it can for the requests in flight to finish, and then sends SIGTERM. The process has one second left.

<<< @/examples/69-web-functions/src/serve.ts{budget}

`stop` refuses new connections, waits up to 800 milliseconds for open requests to finish, and cuts the connections after that. Both cases, waiting and cutting, are tested with a clock the test moves by hand.

<<< @/examples/69-web-functions/test/shutdown.test.ts{drained}

<<< @/examples/69-web-functions/test/shutdown.test.ts{cut}

The documentation tells you not to rely on shutdown code. Some endings, a hardware failure for one, come with no SIGTERM. Data that must be kept is written to an outside store while the request is handled. All this app's SIGTERM handling does is finish sending the answers it had begun.

## Several requests in one execution environment

<!-- section: 69.concurrency -->

The invariant of this chapter is one sentence.

> A value that belongs to one request, read while that request is being handled, is never the value of another request in flight in the same execution environment.

With an Event Function, the execution environment kept this for you. One environment holds one request at a time, so a request ID in a module variable is not overwritten until the next request arrives. In a Web Function, while one request waits at an `await`, the same process starts on the next.

The chapter 04 app passes per-request values in an argument called `context`, so it meets the condition as it is. What breaks is code far from the handler that reads a value from a shared place instead of an argument. Chapter 35 wrote `audited`, which logs one line for each change to a note, and two places to keep the value: `moduleScope`, a module variable, and `asyncScope`, an `AsyncLocalStorage`. This chapter's app imports both from chapter 35 and assembles them.

<<< @/examples/69-web-functions/src/app.ts{app}

Where the request ID comes from differs from chapter 35. In a Web Function, Lambda puts a `lambda-web-request-id` header on the request it forwards, and the same value on the response. The app takes this value as its own request ID, so the ID a caller received finds the app's logs and Lambda's logs alike.

<<< @/examples/69-web-functions/src/app.ts{headers}

Lambda removes any header starting with `lambda-web-` that a caller sent, before forwarding. On your own machine nothing guarantees that, so the value is taken only when it is a short string of letters, digits, hyphens, and underscores, and otherwise the app makes an ID of its own.

The test connects two sockets to a server that is really listening. Request B is handled while request A is stopped partway through its write, and only then does A go on.

<<< @/examples/69-web-functions/test/server.test.ts{overlap}

<<< @/examples/69-web-functions/test/server.test.ts{invariant}

The second test is the version made wrong on purpose. With the value kept in `moduleScope`, the log says that B stored A's note. Both requests get the right answer, with the right ID on the response, so nothing is visible from outside. If code you move from an Event Function has a variable like `let currentRequestId`, the same happens.

Sharing a process changes more than per-request values.

A cache or an SDK client in a module variable stays across requests and is used by every request in flight. That is a welcome property, since connections are reused. But a read, a change, and a write with an `await` between them let another request in. This app's notes are an in-memory `Map` as in chapter 04, and there is no `await` between the check of the limit and the write, so nothing gets in. Once the store moves outside, as in [chapter 05](/en/chapters/05-dynamodb.md), a conditional write is needed.

The number of database connections is the number of execution environments times the size of the pool. An Event Function needed one connection per environment. A Web Function environment handles up to 64 requests at once, so a pool has a point. Each environment has 1,024 file descriptors.

Work that uses the CPU holds up every request in the same environment. Node.js runs JavaScript on one thread, so while a large JSON is parsed or a file is read synchronously, no other request moves. An environment has two vCPUs, and using the second takes `worker_threads`. The other means is to lower the revision's `maxConcurrencyPerEnvironment`, so that fewer requests enter one environment.

`/tmp` is 512 MB, and requests in flight share it too. Give a temporary file a different name for each request.

## The rules of HTTP

<!-- section: 69.http -->

An endpoint accepts HTTP/1.1, with the methods GET, HEAD, POST, PUT, PATCH, OPTIONS, and DELETE. Lambda terminates TLS and forwards the method, the path, the query string, the body, and most headers as they are. `Host` arrives as the endpoint's domain name, and the last value of `X-Forwarded-For` is the address of whoever connected to Lambda. The values before it were written by the caller and are not validated.

Request headers, with the request line, may total 128 KiB, and beyond that Lambda answers 431. The pages read give no limit on the size of a body. There is no upgrade to WebSocket.

A response reaches the caller as the server writes it. [Chapter 17](/en/chapters/17-ai.md) used a function URL and its response streaming setting to return output as it was produced, and a Web Function has no such setting. Chapter 04's `nodeServer` pipes a body without buffering it, so a route that returns a `ReadableStream` streams as it is.

One rule on the request side needs care. Lambda hands over the whole request body before it delivers the response to the caller. A response written before the body has been read waits for a body nobody reads. According to the documentation, bodies up to about 1 MB fit in socket buffers, so small requests do not show the problem.

The chapter 04 app has such a place: where it refuses a body over 64 KiB with a 413, from the `content-length` header alone, without reading a byte. This chapter's app reads and discards what is left of the body before it answers.

<<< @/examples/69-web-functions/src/app.ts{half-duplex}

On your own machine, Node.js delivers the 413 without that. So the test does not ask whether the answer arrives. It asks whether the answer arrives after the whole body has been received.

<<< @/examples/69-web-functions/test/server.test.ts{upload}

When a body sent in chunks, with no length, passes the limit partway, chapter 04's kit stops reading there and then, and this discard does nothing. What happens then on Lambda's path was not confirmed.

The timeout is the revision's `timeoutSeconds`, from 3 to 900 seconds. The default is 30, and this stack sets 10, as chapter 04 did. Past it, Lambda answers 504. A response that was streaming keeps the status already sent, and its body is cut short.

Errors that Lambda itself returns carry a response header, `lambda-web-error-type`. Its values look like `Platform.EndpointRequestThrottle` or `Runtime.RequestTimeout`, and the header tells a 429 from the app apart from a 429 from Lambda.

Everything written to standard output and standard error goes to CloudWatch Logs. Lambda wraps `console` output in a JSON log event and adds `requestId`, `endpointName`, and `region`. Chapter 04's logger does not sit well with this. It passes `console.log` a string made with `JSON.stringify`, and a string lands in the `message` field as one escaped string whose fields no query can reach. An object passed as it is lands under `message` as JSON.

<<< @/examples/69-web-functions/src/log.ts{logger}

The `release` field is there because Web Function metrics have no dimension for the revision. While two revisions share the traffic, the metrics cannot say which one returned the 5xx. The app receives the upload it was made from in the environment variable `RELEASE`, and puts it in the log field and in a response header, `x-aih-release`.

<<< @/examples/69-web-functions/src/app.ts{compose}

## The stack

<!-- section: 69.stack -->

The code is a zip in an S3 bucket with versioning enabled. That is the only way to give code to a Web Function, and a revision points at this version of this object.

<<< @/examples/69-web-functions/infra/lib/web-functions-stack.ts{code}

The bucket policy allows the Lambda service itself. Lambda reads the package as the service, not as the execution role. The `aws:SourceArn` condition limits the reading to revisions of this Web Function. Without the condition, the bucket cannot tell on whose behalf Lambda has come to read.

The object version a revision points at must not be deleted while the revision is in use. Delete it and the revision becomes Failed, and putting the object back does not restore it.

There are two log groups. Lambda first writes to a log group named with `.local` in the Region that handled the request, and then gathers the events into the log group in the home Region. With one Region there are still two log groups.

<<< @/examples/69-web-functions/infra/lib/web-functions-stack.ts{logs}

The execution role is the role the server's code uses when it calls AWS. This app only writes logs, so the role allows writing to the two log groups and nothing else.

<<< @/examples/69-web-functions/infra/lib/web-functions-stack.ts{role}

The Web Function itself is a resource with a name and little more.

<<< @/examples/69-web-functions/infra/lib/web-functions-stack.ts{function}

A revision gets every setting written out. A setting left out takes its default, not the value of the revision before.

<<< @/examples/69-web-functions/infra/lib/web-functions-stack.ts{revision}

The endpoint decides whom to answer, and how much.

<<< @/examples/69-web-functions/infra/lib/web-functions-stack.ts{endpoint}

`authType` has two values. With `ApplicationManaged`, Lambda checks nothing and hands every request to the server. That is an entry point anyone can call, like chapter 04's HTTP API. With `IamAuth`, Lambda checks the SigV4 signature and lets through only requests from principals allowed `lambda:InvokeWebFunctionEndpoint`. This stack uses `IamAuth`, so that a practice endpoint is not left open on the internet.

Even with `IamAuth`, the endpoint's domain name is reachable from the internet. What changes is that Lambda refuses an unsigned request with a 403. Nothing is closed at the network level. A principal of the same account can call the endpoint when its own policy allows it. To let another account or CloudFront call it, you attach a resource-based policy to the Web Function. This stack attaches none.

`rateLimit` and `maxEnvironments` are this stack's brakes.

<<< @/examples/69-web-functions/src/names.ts{limits}

`rateLimit` is the number of requests accepted per second, and Lambda answers 429 to the rest. Unlike the rate limit you counted yourself in [chapter 14](/en/chapters/14-kv-cache.md), it is a number for the whole endpoint, not per caller. `maxEnvironments` caps the number of execution environments, and when all of them are full the answer is again 429. Lambda refuses at once and does not make the request wait. The API Gateway throttling and the reserved concurrency of [chapter 32](/en/chapters/32-limits.md) have become two settings on the endpoint.

Both take only certain values. `rateLimit` is 0, or 100 to 1,000 in steps of 100, or 2,000 to 10,000 in steps of 1,000, so a fine value like chapter 04's ten a second cannot be written. `maxEnvironments` is 2 or more. A value outside the ranges is stopped at synth.

<<< @/examples/69-web-functions/src/release.ts{limits}

Encryption is on without your doing anything. The code and the environment variables are encrypted at rest with a key AWS owns. To use a KMS key of your own, write `kmsKeyArn` on the revision. That secrets do not go in environment variables is as true as it was for Event Functions.

No VPC is used. A Web Function runs on Lambda's side of the network, and with nothing configured it reaches IPv4 destinations on the internet directly. To reach a database inside a VPC you create a resource called an egress network connector and refer to it from the revision. It has nothing to do with the way in, and it is no means of closing an endpoint inside a VPC.

A test pins the resource types the stack creates.

<<< @/examples/69-web-functions/infra/test/web-functions-stack.test.ts{types}

The last three are the types cdkd cannot create. Next comes [Run It Locally](/en/chapters/69-web-functions/local.md).
