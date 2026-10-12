---
title: "64 Isolates: Design and Build"
---

# 64 Isolates: Design and Build

This page starts by making chapter 04's app a workerd worker, then goes through the configuration file, two tests of the isolate's boundaries, the limits workerd does not enforce, and the image and the stack. The whole picture is on the [opening page](/en/chapters/64-isolates.md).

## Making the app a worker

<!-- section: 64.adapter -->

workerd calls `fetch` on the object the main module exports as its default. The arguments are the request and `env`, and `env` holds the bindings the configuration declares. Chapter 04's app is a `Fetch`, a function from a request to a response, so the only thing needed in between is passing `env` along.

<<< @/examples/64-isolates/src/worker.ts{adapter}

On Lambda the app was composed from `process.env` when the module loaded. workerd's bindings arrive with a request, not at module load. So the app is composed on the first request and reused afterwards. Nothing is kept when composing fails, so with a required setting missing, every request fails, health checks included. That is what keeps requests away from a task with a broken configuration.

This is the whole entry file.

<<< @/examples/64-isolates/src/entry.ts{entry}

`composeApp` is imported from chapter 04's file. On Lambda in chapter 04, the same place read `handleApiGateway(app)`.

workerd does not read TypeScript and does not look in `node_modules`. So esbuild puts the entry point and everything behind it into one ES module.

<<< @/examples/64-isolates/src/bundle.ts{bundle}

`platform` is `neutral` so that the bundle leans on neither Node.js nor a browser. Only imports that start with `node:` are left outside. According to Cloudflare's documentation, a worker with a compatibility date of 2026-08-04 or later has the Node.js compatibility APIs by default. `node:crypto`, which chapter 04's app uses, and `node:async_hooks`, used later on this page, are both on the list of supported modules.

## A configuration file from types

<!-- section: 64.config -->

workerd's configuration is Cap'n Proto text. You can write it by hand; this chapter generates it from TypeScript values. One reason is to check in tests that it agrees with the stack's port and environment variables. The other is to stop, before the file is written, mistakes you would otherwise meet at startup.

The values the configuration comes from are a list of workers and a list of sockets. The schema covers only the fields this chapter uses. workerd's configuration has many more.

<<< @/examples/64-isolates/src/definition.ts{worker}

<<< @/examples/64-isolates/src/definition.ts{socket}

Only two kinds of binding are handled: `text`, whose value is written into the configuration file, and `environment`, whose value is an environment variable of the workerd process when it starts. workerd's configuration calls the latter `fromEnvironment`.

<<< @/examples/64-isolates/src/definition.ts{binding}

Besides the checks on each field there are checks on the whole.

<<< @/examples/64-isolates/src/definition.ts{deployment}

Two of the checks follow what workerd does. A compatibility date is accepted only up to the date the pinned version knows. Given a date one day ahead, the local workerd answered with an error saying a compatibility date cannot be set in the future. A module's name is limited to the name of a file in the same directory as the configuration file. The configuration takes files in with `embed`, so if any path could be written here, another file on the machine could be embedded into a worker.

Valibot's `v.isoDate()` looks at the shape only, so it lets `2026-02-31` through. An explicit check covers whether the date is on the calendar.

The text is assembled from the values that passed.

<<< @/examples/64-isolates/src/capnp.ts{render}

Strings are limited to printable ASCII by the schema, and then only quotes and backslashes are escaped.

<<< @/examples/64-isolates/src/capnp.ts{text}

The configuration the container uses is generated from this definition.

<<< @/examples/64-isolates/src/deployments.ts{image}

Values that differ between environments are not written into the configuration file; they come from environment variables. One image then serves every stage. `forwardedProtoHeader` makes workerd read the `x-forwarded-proto` header the load balancer adds and set the scheme of `request.url` to the one the caller used. Chapter 04's app does not look at the scheme, so nothing behaves differently yet.

A test pins the generated file character by character.

<<< @/examples/64-isolates/test/definition.test.ts{rendered}

That the real workerd accepts this file is checked by another test.

<<< @/examples/64-isolates/test/workerd.test.ts{image}

## Two workers in one process

<!-- section: 64.apart -->

The first invariant of this chapter is that **separate workers in the same process share no state**.

The tests start the real workerd binary that npm brought. The kernel picks the ports, and the test reads the numbers workerd reports through `--control-fd`.

<<< @/examples/64-isolates/src/runtime.ts{start}

The configuration names two workers that load the same bundle. There is one copy of the code on disk, and one process.

<<< @/examples/64-isolates/test/workerd.test.ts{apart}

The note created on A cannot be seen from B. Chapter 04's app keeps notes in a `Map` inside a module, so B's empty list means that B has a module scope of its own. The bindings, too, arrive with a different value for each worker.

What this test shows goes only as far as this: the two workers do not touch each other's state with code written in the ordinary way. Whether the boundary holds against code that exploits a bug in V8 is not something a test can settle. For that, the README's warning on the opening page stands.

The configuration schema has one more caution. A worker that inherits another with `inherit` runs, it says, in the same isolate as the worker it inherits from. This chapter's definition does not use `inherit`.

## Two requests in one worker

<!-- section: 64.scope -->

The second invariant is about the inside of a worker. **One isolate handles several requests at once, and module scope is shared by all of them.** Cloudflare's documentation says the same: a single Workers instance handles concurrent requests in a single-threaded event loop, and it recommends that you do not use or mutate global state.

In chapter 04's app that sharing is in plain sight. The `Map` that holds the notes is visible to every request for as long as the isolate lives.

<<< @/examples/64-isolates/test/worker.test.ts{shared}

Sharing becomes a problem for values that belong to one request. Chapter 35 reproduced, on Node.js, a request ID kept in a module-scope variable being swapped between two requests in flight. Here chapter 35's app goes onto workerd as it is, to check the same thing.

<<< @/examples/64-isolates/src/entry-scoped.ts{entry}

The test sends half of request A's body and stops. The worker has received A and is waiting for the rest of the body. Meanwhile the test sends B and receives its answer, and only then sends the rest of A. The order "B arrives while A is in flight" is produced without relying on a delay.

<<< @/examples/64-isolates/test/workerd.test.ts{leak}

With module scope, the log line for the note A stored carries B's request ID. With `AsyncLocalStorage` it carries A's. The fault chapter 35 showed on Node.js, and its fix, are the same on workerd.

For a reader who comes from Workers this is nothing new. Only standard Lambda made the unusual promise that one execution environment handles one request at a time. On workerd that promise is gone.

## The limits workerd does not enforce

<!-- section: 64.limits -->

Workers has limits per request. On the Limits page as read on 2026-10-13, the CPU time of one HTTP request is 30 seconds by default on the paid plan and 5 minutes at most. Memory is 128 MB per isolate.

workerd's configuration schema has no field that limits a worker's CPU time or memory. In the server's source, each worker's isolate is handed an implementation whose comment says it enforces no limits. Those two points are all that was read in the source, so the behaviour was checked locally. The worker for checking it holds the CPU for as long as it is asked to.

<<< @/examples/64-isolates/src/spin.ts{spin}

`vp run isolates:observe` loads this worker and chapter 04's app into one workerd, asks spin for 2000 ms, and 200 ms later calls `/health` on the app next to it.

<<< @/examples/64-isolates/scripts/observe.ts{cpu}

This is the result on workerd 1.20261012.1 for macOS (arm64).

```text
1. One worker holds the CPU for 2000 ms
   the spinning worker: answered 200 after 2012 ms and 33957991 turns of its loop
   its neighbour, asked 200 ms in: answered 200 after 1807 ms
```

The loop ran for two seconds without being cut off. During that time `/health` on the neighbouring worker could not be answered, and it came back after the loop ended. Workers share no state, but they share a thread. One worker running away stops every worker in the same process. The load balancer's health check is answered by that same thread, so if the runaway lasts, the task is judged unhealthy and replaced.

The only limits you can add are outside the process. The task is given 512 MB of memory, and that is the ceiling for the workerd process as a whole (what happens beyond it is in [chapter 41](/en/chapters/41-fargate.md)). The load balancer closes a connection on which no data has moved for 60 seconds, but what it closes is the connection; the loop inside the worker does not stop. This design has no limit on CPU time per request.

No experiment used up the memory. Whether Linux gives the same result was not checked either.

## The image and the stack

<!-- section: 64.image -->

Three things go into the image: the workerd binary, the configuration file, and the bundle. That combination of three is one version, and it gets a tag. The repository forbids moving a tag, so a tag keeps naming one combination.

`vp run isolates:fetch` downloads the Linux arm64 binary from the npm registry. If the size and digest do not match the pinned values, it stops without unpacking.

<<< @/examples/64-isolates/scripts/fetch.ts{verify}

A matching digest tells you only that the bytes are the ones in the npm registry. The registry shows a provenance attestation for this package; this chapter did not verify it.

The Dockerfile is short and does not go out to the network.

<<< @/examples/64-isolates/Dockerfile

The base image is Debian 12 because of the glibc version. Why `CMD` is written as an array, and how SIGTERM arrives, is explained in chapter 12. The Nix shell has no Docker daemon, so this image was never built.

The stack has the shape of chapter 12's; what differs is the task definition and the number of tasks.

<<< @/examples/64-isolates/infra/lib/isolates-stack.ts{task}

The names of the environment variables have to match `fromEnvironment` in the configuration. Change one side only and the binding does not arrive: the app runs on a default, or fails to compose. The port is the same: if the socket in the configuration and the task definition hold different numbers, the health check does not pass. A test holds the two against each other.

<<< @/examples/64-isolates/infra/test/isolates-stack.test.ts{bindings}

`readonlyRootFilesystem` rests on the assumption that workerd writes nothing to disk. On macOS, workerd was started with every file write denied, and it answered requests. On Fargate this was not checked.

The service keeps the old task until the new one is healthy.

<<< @/examples/64-isolates/infra/lib/isolates-stack.ts{service}

There is one task. With two, there are two workerd processes and two `Map`s of notes. A note created on one task cannot be seen from the other. It is the same as on Lambda in chapter 04, where each execution environment had its own `Map`. Until the state lives outside, adding tasks does not give you a correct app.

When replacing a task, ECS takes the old one out of the load balancer and then sends SIGTERM (chapter 12). How workerd treats SIGTERM was not found in its documentation, so it was observed locally.

<<< @/examples/64-isolates/scripts/observe.ts{sigterm}

```text
2. SIGTERM with a request in flight
   a new request, sent 200 ms after SIGTERM: no answer within 1500 ms
   the request in flight, finished 1700 ms after SIGTERM: answered 201
   workerd: exited with 0, 1708 ms after SIGTERM

3. SIGTERM, then a request on a new connection
   the request, sent 200 ms after SIGTERM: connect ECONNREFUSED 127.0.0.1:64167
   workerd: exited with 0, 2 ms after SIGTERM

4. SIGTERM with an idle keep-alive connection open
   before SIGTERM: answered 200 after 2 ms
   the same connection, 200 ms after SIGTERM: connect ECONNREFUSED 127.0.0.1:64170
   workerd: exited with 0, 1 ms after SIGTERM
```

With a request in flight, workerd answered it and then exited with code 0. With nothing in flight it exited at once, even with an idle connection left open. The line to watch is the first one of the second observation. A new request that arrived while workerd was waiting to exit got no answer. As long as the order holds, out of the load balancer first and SIGTERM second, that situation does not come up. How long workerd waits for a request in flight, and whether there is a bound, was not checked. ECS sends SIGKILL at the `stopTimeout` of 30 seconds, so the wait ends there.

All of these observations were made on macOS. Whether SIGTERM reaches workerd running as PID 1 in a container was not checked, because the image was not built.
