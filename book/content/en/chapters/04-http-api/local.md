---
title: "04 HTTP API: Run It Locally"
---

# 04 HTTP API: Run It Locally

## Run it on your machine

<!-- section: 04.local -->

Let's run it. Copy `examples/04-http-api/.env.example` to a file named `.env` in the same place.

<<< @/examples/04-http-api/.env.example

```bash
vp run dev:api
```

The API comes up at <http://localhost:8787>. Try hitting it from another terminal.

```bash
curl -s http://localhost:8787/health
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/notes
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":""}'
```

The last one fails on purpose. You should get back a 400 whose `code` is `invalid_request` and whose `issues` include `title`. In the server's terminal, one line of JSON goes by for each request. Save a source file and it restarts on its own.

Here's all there is to this development server.

<<< @/examples/04-http-api/src/dev.ts{dev}

It's the same app that runs on Lambda, sitting on an ordinary Node.js HTTP server. That's why it's light, and why nothing gets billed. The flip side: it isn't Lambda itself, so some things aren't reproduced.

- **API Gateway's routes**: in production, for a path you didn't define, API Gateway returns 404 before the request reaches Lambda
- **Lambda's limits**: work that runs past 10 seconds is cut off. Memory has a ceiling too
- **IAM**: AWS operations you haven't allowed are denied
- **API Gateway's CORS**: in production, API Gateway answers preflight requests before they ever reach Lambda
- **Execution environments coming and going**: what's in memory isn't guaranteed to still be there at the next invocation

That last one is the star of the second half of this chapter.

### When you want to get one step closer to production

cdkd has a feature that runs API Gateway and Lambda in local containers.

```bash
vp run dev:api:cdkd
```

This one needs a Docker daemon to be running. Entering the devShell doesn't bring Docker along, so start Docker Desktop or something like it separately.

One thing to watch out for. Going by cdkd's source and documentation, this feature hands the container that runs the handler **your own credentials** by default. If the handler calls the AWS SDK, the call reaches real AWS, and gets billed, even though the handler is running locally. On top of that, it runs with your permissions rather than the execution role's, so "it worked here" doesn't mean "the permissions will be enough after deployment". This chapter's handler doesn't call AWS, so it doesn't matter here, but keep it in the back of your mind from chapter 05 on.

To be honest, this task hasn't actually been run yet.

## Tests

<!-- section: 04.tests -->

```bash
vp run test:unit
```

The tests live in three places. Each one is looking at something different.

| Where | File | What it looks at | What it doesn't look at |
| --- | --- | --- | --- |
| App | `test/app.test.ts` | Input validation, the error shape, the request ID, CORS | How things behave through Lambda and API Gateway |
| Client | `test/client.test.ts` | The contract between client and server. Handling of responses that break the contract | A real network |
| Infrastructure | `infra/test/http-api-stack.test.ts` | Permissions, log retention, timeout, routes | That AWS behaves as the template says |

The app tests don't open a port. They hand a `Request` straight to the Hono app, and that's it.

The client tests have no hand-written mock. They pass the real app to the client as its transport, as is. If you change the server implementation and the contract breaks, this test fails.

Here's that client.

<<< @/examples/04-http-api/src/client.ts{client}

Thanks to `hc<App>`, the server's routes and response types reach the client at compile time. Mistype a path and it's a type error. Feels good, doesn't it?

But what this type describes is **the code in this repository**. The server that actually answers isn't necessarily the same version. It might be an old deployment, or a proxy along the way might return an error page. So the client runs the response it received through the schema before returning it. "200 but the wrong shape" and "502 that came back as HTML" are both in the tests.

There's one more test, and it's a slightly odd one. It creates two instances of the app and checks that a note written to one can't be seen from the other. It isn't hunting for a bug. It pins down, as a specification, what the next section is about.

## Where do the notes live?

<!-- section: 04.state -->

Lambda runs your function inside an isolated box called an execution environment. The box is created and initialized at the time of the first invocation. That's a cold start. For a while after that, the same box gets reused.

<<< @/examples/04-http-api/src/lambda.ts{handler}

`composeApp` sits at the outermost level of the file. That part runs once per box, not once per request. The `Map` that holds the notes is created then too, one of it.

So what happens?

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

Look at t3. When the next request arrives while A is in the middle of handling another one, Lambda creates a second box, B. B's `Map` is empty. You called the same URL as at t2, and the answer is different.

At t4, A has gone unused for a while and gets cleaned up, and `n1` no longer exists anywhere.

In other words, what you keep in Lambda's memory can work as a cache, but **it can't be the owner of the data**. There may be more than one box, and you don't get to choose when one disappears. Once chapter 05 adds DynamoDB, the owner becomes the table, and you get the same answer no matter which box does the reading.

You can actually observe this on the deployed API.

```bash
vp run api:smoke
```

This task creates one note and reads it straight back. If the read lands on a different box it gets a 404, but the task doesn't treat that as a failure; it prints that a different execution environment answered. With the way this chapter is built, that's the correct thing to expect.
