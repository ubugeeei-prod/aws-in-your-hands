---
title: "64 Isolates: Run It Locally"
---

# 64 Isolates: Run It Locally

No command on this page touches AWS. You need no account, no credentials, and no Docker.

## Chapter 04's app in workerd on your machine

<!-- section: 64.local -->

`vp install` brings the workerd binary from npm. Inside the Nix devShell, 1.20261012.1 for macOS (arm64) was confirmed to start. The README says workerd is tested on Linux and macOS for x86-64 and arm64, and on Windows for x86-64. On Linux it needs glibc 2.35 or newer. This chapter was not run on Linux.

The `workerd` package has a postinstall script, and pnpm does not run it without approval. Every `vp install` prints "Ignored build scripts: workerd", but this chapter's code finds the binary in the per-platform package directly, so it works without the script.

<<< @/examples/64-isolates/src/runtime.ts{installed}

Start the app.

```bash
vp run dev:isolates
```

The task first writes the bundles to `dist/`, generates the configuration file for local use, and then starts workerd.

<<< @/examples/64-isolates/src/deployments.ts{local}

<<< @/examples/64-isolates/scripts/serve.ts{serve}

The same notes API as in chapter 04 runs on `http://localhost:8787`. Call it from another terminal.

```bash
curl -si http://localhost:8787/health
curl -s -X POST http://localhost:8787/notes -d '{"title":"hello","body":"from workerd"}'
curl -s http://localhost:8787/notes
```

This is the answer to `/health` and workerd's standard output from an actual run. The request IDs change on every run.

```text
HTTP/1.1 200 OK
Content-Length: 31
Content-Type: application/json
Access-Control-Allow-Origin: http://localhost:5173
Vary: Origin
x-request-id: f749b1f3-f6e7-4dd4-a3b8-1d524aaf21a5

{"status":"ok","stage":"local"}
```

```text
{"level":"info","message":"request","requestId":"f749b1f3-f6e7-4dd4-a3b8-1d524aaf21a5","method":"GET","path":"/health","status":200,"durationMs":4}
{"level":"info","message":"request","requestId":"62b15f1c-0e5e-4298-98aa-f57fc3e65a02","method":"POST","path":"/notes","status":201,"durationMs":10}
{"level":"info","message":"request","requestId":"37d6db12-328b-4dea-96de-ccf7448a8d80","method":"GET","path":"/notes","status":200,"durationMs":0}
```

The log is the JSON chapter 04's logger wrote, one line each, as it is. Nothing is put in front of a line, unlike on Lambda, which adds a timestamp and a request ID.

Run the tests with this command.

```bash
vp test run examples/64-isolates
```

The tests are in five files.

- `test/workerd.test.ts`: the tests that start the real workerd. They check that chapter 04's app answers as its contract says, that two workers share no state, that two requests in flight share module scope, that bindings arrive from the configuration and from environment variables, and that workerd accepts the image's configuration file. On a machine where the binary does not start, the tests in this file are skipped and one line says so
- `test/worker.test.ts`: the adapter, called on Node.js
- `test/definition.test.ts`: what the configuration schema refuses, the content of the generated file, and matching the pinned archive
- `test/pricing.test.ts`: the pricing inputs and arithmetic
- `infra/test/isolates-stack.test.ts`: stack assertions

Behaviour that is a matter of time is looked at with a task for observing, not with tests. It takes about 20 seconds.

```bash
vp run isolates:observe
```

The template and the files that go into the image can be made locally too.

```bash
vp run isolates:infra:synth -c imageTag=v1
vp run isolates:fetch
vp run isolates:bundle
vp run isolates:image:build v1 --dry-run
```

`isolates:fetch` downloads an archive of about 40 MB from the npm registry, checks it, and unpacks it into `examples/64-isolates/.workerd/`. It does not run the binary it downloaded. `isolates:image:build` with `--dry-run` only prints the `docker` command.

That is as far as local checks go. The local workerd is the macOS build, and what goes into the image is a different binary, for Linux arm64. Starting in a container, running on Fargate, requests through the load balancer, and replacing tasks were never run for this chapter.
