---
title: "69 Web Functions: Run It Locally"
---

# 69 Web Functions: Run It Locally

The server read in [Design and Build](/en/chapters/69-web-functions/build.md) is the same file that goes to Lambda, and Node.js on your machine starts it as it is. This page starts it, tests it, checks the package, and ends with what a laptop cannot tell you. None of the steps uses an AWS account.

## Start it and call it

<!-- section: 69.local -->

Copy the settings file and start the server.

```bash
cp examples/69-web-functions/.env.example examples/69-web-functions/.env
vp run dev:webfn
```

Call it from another terminal. A `lambda-web-request-id` you set yourself ends up in the response's `x-request-id`, as it does when Lambda sets it.

```bash
curl -i http://127.0.0.1:8787/health
curl -i -H 'lambda-web-request-id: from-my-terminal' \
  -d '{"title":"first","body":""}' http://127.0.0.1:8787/notes
```

`AWS_LAMBDA_HTTP_ENDPOINT` was not set, so the server listens on `127.0.0.1:8787` and logs one line of JSON, as in chapter 04. Give the variable a value such as `127.0.0.1:3000` in `.env`, and the address is read on the same path as on Lambda, and the logger passes objects to `console`. In a terminal an object is printed in Node.js's own format, not as JSON.

One task does what Lambda does: it starts the entry file as a process of its own, sends requests at the same time, and stops it with SIGTERM.

```bash
vp run webfn:demo
```

```text
listening on 127.0.0.1:63789 after 107 ms
50 requests at once in one process: 50 answered under their own request ID
SIGTERM: exited with code 0 after 4 ms (Lambda allows 1000 ms)
```

The port and the times change with every run. The times are from a Mac, not the start time in a Lambda execution environment.

## Tests

There are 9 test files and 68 tests.

```bash
vp test run examples/69-web-functions
```

The tests that involve the server do not call the app as a function. They open a real socket with `serve` and connect with `fetch` and `node:http`. Two requests in flight together, the preflight, the upload over the limit, and stopping after SIGTERM are all tested that way.

The zip package has a test of its own. It builds the same archive that goes to Lambda, extracts it into an empty directory, and starts the server from the files found there and nothing else.

<<< @/examples/69-web-functions/test/package.test.ts{package}

The failure this test guards against is "it only ran locally because `node_modules` was there". The runtime loads `index.js` at the root of the package. It does not look at `main` in `package.json`. And if `index.js` uses `import`, the `package.json` next to it needs `"type": "module"`. The code that assembles the package makes those two files and no others.

<<< @/examples/69-web-functions/scripts/build.ts{package}

The Nix shell has no `zip` command, so the archive is written here. DEFLATE is left to `node:zlib`, and what remains is the headers and the directory. The date is fixed, so the same files give the same bytes, and a checksum identifies a build.

<<< @/examples/69-web-functions/src/zip.ts{zip}

To build only the archive and see its size and checksum, use this task.

```bash
vp run webfn:package
```

## synth

Synthesizing the stack is local too. It asks AWS nothing.

```bash
vp run webfn:cfn:synth
vp run webfn:cfn:synth -c stable=v1 -c canary=v2 -c canaryWeight=10
```

The first is the template before any package has been uploaded, with no revision and no endpoint. The second splits traffic 90 to 10 between two revisions. `v1` and `v2` stand in for S3 version IDs, and synth does not check that the objects exist.

AWS CDK CLI 2.1145.0 prints this warning on every synth.

```text
WARNING Unknown resource type 'AWS::Lambda::WebFunction' (CloudFormation Validate)
```

The validation rules bundled with the CLI do not know the type, hence the warning, and the template is written all the same. Whether CloudFormation accepts this template was not confirmed, since nothing was deployed.

## What a laptop cannot tell you

<!-- section: 69.laptop-limits -->

What you can check locally is the behaviour of a server. Routes, headers, keeping requests in flight apart, stopping, and the contents of the package are the same code behaving the same way on Lambda.

What Lambda decides is not reproduced locally.

- **The start.** Whether the bundled `index.js` loads on the `nodejs24.x` runtime and listens within 10 seconds. Your Node.js runs on macOS, not on Arm64 Linux
- **Authorization.** That an unsigned request is refused with a 403 and a signed one gets through. The local server answers anyone
- **What Lambda adds.** The real shape of `lambda-web-request-id`, `X-Forwarded-For`, the headers it removes, `lambda-web-error-type`
- **Handing over the body.** Behaviour under the rule that the response is delivered only after the body has been handed over. Node.js on your machine sends a response partway through a body
- **Scaling and throttling.** When environments appear and disappear, and the 429 from `rateLimit` and `maxEnvironments`
- **Logs.** That an object passed to `console` lands under `message` as JSON, and how long events take to reach the two log groups
- **CPU time and memory.** The two values the bill is made from. The values of a local process do not stand in for them

The documentation, too, says that IAM authorization, access to S3 and KMS, the states of revisions and endpoints, scaling, and telemetry need tests in the cloud. The steps on the next page, [Deploy](/en/chapters/69-web-functions/deploy.md), are prepared for that.
