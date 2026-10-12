---
title: "04 HTTP API: Run It Locally"
---

# 04 HTTP API: Run It Locally

This page takes the app written on [the previous page](/en/chapters/04-http-api.md), runs it on your machine without AWS, and tests it. It ends with what happens to notes kept in memory once the app is on Lambda.

## Run it on your machine

<!-- section: 04.local -->

Copy `examples/04-http-api/.env.example` to a file named `.env` in the same place.

<<< @/examples/04-http-api/.env.example

```bash
vp run dev:api
```

The API starts at <http://localhost:8787>. Call it from another terminal.

```bash
curl -s http://localhost:8787/health
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/notes
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":""}'
```

The last call fails on purpose. You should get a 400 whose `code` is `invalid_request` and whose `issues` include `title`. The server's terminal prints one line of JSON for each request, and the server restarts by itself when you save a source file.

The development server is nothing more than this code.

<<< @/examples/04-http-api/src/dev.ts{dev}

It puts the same app that runs on Lambda on an ordinary Node.js HTTP server. It starts quickly and costs nothing. It isn't Lambda, though, so it doesn't reproduce the following.

- API Gateway's routes. In production, API Gateway answers a request for a path you didn't define with a 404 before it reaches Lambda
- Lambda's limits. Work that runs past 10 seconds is cut off, and memory has a ceiling
- IAM. AWS operations you haven't allowed are denied
- API Gateway's CORS. In production, API Gateway answers preflight requests before they reach Lambda
- Execution environments being replaced. What is in memory may not be there at the next invocation

"Where the notes live" on this page covers the last item in detail.

### Getting a little closer to production

cdkd can run API Gateway and Lambda in local containers.

```bash
vp run dev:api:cdkd
```

This task needs a running Docker daemon. The devShell doesn't include Docker, so start Docker Desktop or a similar tool separately.

One warning. As far as cdkd's source and documentation show, this feature gives the container that runs the handler **your own credentials** by default. If the handler calls the AWS SDK, the call reaches real AWS and is billed, even though the handler runs locally. It also runs with your permissions and not the execution role's, so a handler that works here may still lack permissions after deployment. This chapter's handler doesn't call AWS, so nothing changes here, but be careful from chapter 05 on.

This task has not actually been run yet.

## Tests

<!-- section: 04.tests -->

```bash
vp run test:unit
```

The tests are in three places, and each checks something different.

| Where | File | What it checks | What it doesn't check |
| --- | --- | --- | --- |
| App | `test/app.test.ts` | Input validation, the error shape, the request ID, CORS | How things behave through Lambda and API Gateway |
| Client | `test/client.test.ts` | The contract between client and server. Handling of responses that break the contract | A real network |
| Infrastructure | `infra/test/http-api-stack.test.ts` | Permissions, log retention, timeout, routes | That AWS behaves as the template says |

The app tests don't open a port. They pass a `Request` straight to the Hono app.

The client tests have no hand-written mock. They give the client the real app as its transport, so if a change to the server breaks the contract, these tests fail.

This is the client.

<<< @/examples/04-http-api/src/client.ts{client}

`hc<App>` carries the server's routes and response types to the client at compile time, so a mistyped path is a type error.

What the type describes, though, is **the code in this repository**. The server that actually answers may not be the same version. An old deployment may answer, or a proxy on the way may return an error page. So the client validates each response against the schema before returning it. The tests include a 200 with the wrong shape and a 502 that comes back as HTML.

One more test creates two instances of the app and checks that a note written to one can't be seen from the other. It isn't there to find a bug. It fixes, as a specification, the behavior the next section explains.

## Where the notes live

<!-- section: 04.state -->

Lambda runs your function inside an execution environment. An execution environment is isolated from the others, and it is created and initialized at the first invocation. That creation and initialization is a cold start. For a while afterwards, the same execution environment is reused.

<<< @/examples/04-http-api/src/lambda.ts{handler}

The call to `composeApp` is at the top level of the file. It runs once per execution environment, not once per request, and the `Map` that holds the notes is created at that moment, one per environment.

The next figure shows what happens when there are two execution environments.

```figure
type: sequence
caption: Each execution environment has its own Map, so the same GET /notes gets different answers at t2 and t3.
actor client: Client
actor a: execution environment A
actor b: execution environment B
step client -> a: t1 POST /notes
note a: created; Map = {n1}
step client -> a: t2 GET /notes
step a --> client: reused; returns [n1]
step client -> b: t3 GET /notes
note a: busy with another request
note b: created; Map = {}
step b --> client: returns []
note a: t4 idle for a while
note a: discarded; n1 is gone
```

At t3 the next request arrives while execution environment A is still handling another one, so Lambda creates a second environment, B. B's `Map` is empty, and the same URL that was called at t2 returns something different. At t4, A has been idle for a while and is discarded, and `n1` exists nowhere.

What you keep in Lambda's memory can serve as a cache, but **it can't be the owner of the data**. There may be more than one execution environment, and you don't choose when one disappears. When chapter 05 adds DynamoDB, the table becomes the owner, and every execution environment reads the same data.

You can observe this on the deployed API.

```bash
vp run api:smoke
```

`api:smoke` creates one note and reads it straight back. If the read reaches a different execution environment it gets a 404, and the task doesn't count that as a failure. It prints that another execution environment answered, because with the way this chapter is built a 404 is also correct behavior.
