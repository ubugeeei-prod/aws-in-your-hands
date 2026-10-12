---
title: "35 Lambda Managed Instances: Run It Locally"
---

# 35 Lambda Managed Instances: Run It Locally

No command on this page touches AWS. You need neither an account nor credentials.

## Run it locally

<!-- section: 35.local -->

Start the API.

```bash
cp examples/35-lambda-managed-instances/.env.example examples/35-lambda-managed-instances/.env
vp run dev:lmi
```

The same notes API as in chapter 04 runs on `http://localhost:8787`. The difference is one more log line, `note stored` or `note deleted`, each time a note is stored or deleted, with the request ID on it.

<<< @/examples/35-lambda-managed-instances/src/dev.ts{dev}

Started with the environment variable `SCOPE=module`, it is the version that keeps the request ID in module scope. As long as you type `curl` by hand, though, that version logs correctly as well. The in-memory repository never waits on a write, so there is hardly a moment at which two requests overlap. To see the bug reliably, use the tests that fix the order.

```bash
vp test run examples/35-lambda-managed-instances
```

The tests are in eight files.

- `test/scope.test.ts` and `test/server.test.ts`: two requests in flight swap request IDs, and with `AsyncLocalStorage` they do not. The first uses function calls, the second real sockets
- `test/threads.test.ts`: two worker threads hold separate `Map`s
- `test/config.test.ts`: validation of the settings
- `test/network.test.ts`: whether a path exists from the chapter 11 subnets to CloudWatch Logs. It reads the route model and looks at nothing deployed
- `test/pricing.test.ts` and `test/break-even.test.ts`: the pricing inputs and the break-even arithmetic
- `infra/test/managed-instances-stack.test.ts`: assertions on the stack

The cost and the path can be checked with one command before deploying.

```bash
vp run lmi:plan
```

It prints the settings of the function and the instances, the path from the subnets to CloudWatch Logs, what it costs just to exist, and the load above which it is cheaper than standard Lambda. With a chapter 11 network that has no endpoint (`vp run lmi:plan interfaceEndpoints=`), it reports the missing path and ends with exit code 2.

The template is produced by this command.

```bash
vp run lmi:infra:synth
```

esbuild bundles the handler and the template is written to `examples/35-lambda-managed-instances/cdk.out/`. Nothing is asked of AWS. The VPC ID and subnet IDs refer to the outputs of the chapter 11 stack by name, so they receive their values at deploy time.

That is as far as a laptop goes. None of the following was ever run for this chapter.

- Lambda's execution environment itself: how many worker threads start, and how requests are handed out
- Scaling, and throttling when it does not come in time
- Instances starting, being replaced, and ending. The launch post says an instance lives 14 days at most
- Code that keeps running after a timeout

The local Node.js server shares exactly one thing with Lambda Managed Instances, handling several requests in one process, and is otherwise something else. cdkd can run a stack in local Lambda containers, but that needs a Docker daemon, which the Nix shell does not include. Whether those containers reproduce the concurrency of Lambda Managed Instances was not checked either.
