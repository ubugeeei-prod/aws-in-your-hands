---
title: "69 Web Functions: Running an HTTP Server on Lambda As It Is"
sourceRevision: 1
---

# 69 Web Functions: Running an HTTP Server on Lambda As It Is

The notes API of [chapter 04](/en/chapters/04-http-api.md) was a function from a `Request` to a `Response`. To run it on Lambda you put one adapter in between, which turned API Gateway's event into a `Request`, and on your own machine you ran the same function behind a `node:http` server. Lambda Web Functions, announced on October 12, 2026, put that local shape on Lambda unchanged. Your code is an HTTP server listening on a port, and it needs neither the adapter nor API Gateway.

This chapter runs the chapter 04 app as a Web Function without rewriting it. What changes is the few lines that start the server, and one assumption. On Lambda until now, one execution environment handled one request at a time. In a Web Function, one execution environment handles several requests at once. The code this breaks is the code [chapter 35](/en/chapters/35-lambda-managed-instances.md) broke, and this chapter tests it over real sockets.

The same announcement gave the functions you already have a name: Lambda Event Functions. Only the name changed, and neither code nor configuration needs touching. This chapter says Event Function for chapter 04's shape and Web Function for the new one.

The stack in this chapter has not been deployed to AWS. The day after the announcement, the documentation and the price list were read and everything that runs on a laptop was run, and that is as far as this chapter's verification goes. What was not confirmed is collected in the verification notes on the [costs page](/en/chapters/69-web-functions/wrap.md).

You need the notes API of chapter 04. The code is in `examples/69-web-functions/`.

## What a Web Function is

<!-- section: 69.overview -->

The code of a Web Function is a Node.js HTTP server. Lambda passes the address to listen on in the environment variable `AWS_LAMBDA_HTTP_ENDPOINT`, and once the server accepts connections there, Lambda forwards the requests that arrive over HTTPS as HTTP/1.1. There is no handler, no event, and no `event.requestContext`.

The entry file of this chapter is all of this:

<<< @/examples/69-web-functions/src/index.ts{entry}

`composeWebApp` returns a function of the same shape as in chapter 04, and inside `serve` is chapter 04's `nodeServer`. On your machine, Node.js starts the same file as it is.

```bash
vp run dev:webfn
```

As of 2026-10-13, the documentation says the following.

- **Regions.** Five: N. Virginia, Ohio, Oregon, Tokyo, and Ireland. This chapter's stack goes to Tokyo (`ap-northeast-1`)
- **Runtime.** Node.js 24 (`nodejs24.x`) only. Other languages use Event Functions
- **Size of an execution environment.** Every environment has 2 Arm64 vCPUs and 2 GB of memory, and that cannot be changed. There is no setting like the 256 MB chapter 04 chose
- **Concurrency.** One execution environment takes 64 requests at once by default and 128 at most
- **Price.** You pay for requests, for the CPU time your code actually uses, for memory while an execution environment exists, and for data transfer. With no requests there are no environments, and the bill is close to nothing
- **Entry point.** Each endpoint gets one HTTPS domain name. A custom domain and AWS WAF need CloudFront in front

## The whole picture

<!-- section: 69.picture -->

In chapter 04 a request went through API Gateway, became a Lambda event, and was turned back into a `Request` by the adapter. In a Web Function, the request the endpoint receives reaches the server as it is.

```figure
caption: The HTTPS request an endpoint receives reaches the server as HTTP/1.1
direction: right
node caller: Caller | signs with SigV4
node endpoint: Endpoint | IamAuth
node env: Execution environment | Node.js server
edge caller -> endpoint: HTTPS
edge endpoint -> env: HTTP/1.1
group fn: Web Function = endpoint, env
mark env
```

Some things go away, and two new resources arrive. A revision is your code and configuration fixed at one moment, and it cannot be changed afterwards. An endpoint is the HTTPS entry point, and it routes requests to one or two revisions by weight. A deployment becomes two operations: create a new revision, then move the endpoint's weights.

```figure
caption: An endpoint routes to revisions by weight, and a revision points at one version of an S3 object
node endpoint: Endpoint | weights 90 and 10
node r1: Revision 1
node r2: Revision 2
node v1: function.zip | version 1
node v2: function.zip | version 2
edge endpoint -> r1: 90
edge endpoint -> r2: 10
edge r1 --> v1: pinned
edge r2 --> v2: pinned
group fn: Web Function = endpoint, r1, r2
group s3: S3 bucket = v1, v2
mark endpoint
```

This chapter's stack creates an S3 bucket for the code, an execution role, two log groups, the Web Function, a revision, and an endpoint. The endpoint is guarded by IAM and has a cap on requests per second and on the number of execution environments.

The deployment tool differs from the other chapters. The pinned cdkd 0.296.28 cannot create Web Function resources, so this one stack uses the AWS CDK CLI and CloudFormation, as [chapter 20](/en/chapters/20-shipping.md) does. The reasons and the steps are on the [deploy page](/en/chapters/69-web-functions/deploy.md).

## When not to use one

<!-- section: 69.when-not -->

A Web Function answers HTTP requests. Work that starts from something other than HTTP, such as a queue message, an S3 event, or a schedule, stays in an Event Function. There is no reason to move the worker of [chapter 08](/en/chapters/08-async.md) to a Web Function.

It does not run languages other than Node.js. It does not support WebSocket either, and for one-way streaming from the server you use server-sent events. An endpoint can only be created where the internet reaches it, so an entry point closed inside a VPC needs a different setup.

It is a poor fit for work that keeps the CPU busy. The price is on CPU time, and one vCPU-second costs about 2.4 times one GB-second of an Event Function. The more a request waits, the cheaper it is, and the more it computes, the dearer. The arithmetic for where the line falls is on the [costs page](/en/chapters/69-web-functions/wrap.md).

If traffic is low and chapter 04's setup works well, there is no need to move. Chapter 04's example of a million requests a month costs USD 2.02 at list price with an Event Function and an HTTP API, and between 2.74 and 3.96 as a Web Function, assuming an execution environment that stays for the whole month. The difference depends on how long an environment stays after requests stop, and the documentation does not say.

Cloudflare Workers and Vercel have features of the same shape. The costs page compares them.

The next page, [Design and Build](/en/chapters/69-web-functions/build.md), reads the server's start and stop, the handling of requests in flight together, and the stack.
