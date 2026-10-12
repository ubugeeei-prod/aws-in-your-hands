---
title: "48 SDK: Run It Locally"
---

# 48 SDK: Run It Locally

## Run It Locally

<!-- section: 48.local -->

All of this chapter's code runs on your machine. It needs no AWS account and no credentials. Whatever the [pages so far](/en/chapters/48-sdk/build.md) called "confirmed" is what these tests do.

```bash
vp test run examples/48-sdk
```

There are 11 files and 104 tests. Each connects the real client to a server on the loopback interface, and nothing leaves the process. The tests that check waits fix the random number and really wait a few hundred milliseconds, so the whole run takes about 2 seconds.

To see the SDK's defaults for the version on your own machine, run this.

```bash
vp run sdk:defaults
```

```text
{
  "retries2026": false,
  "retryMode": "standard",
  "defaultsMode": "legacy",
  "maxAttempts": {
    "dynamodb": 3,
    "s3": 3,
    "constant": 3
  },
  "backoff": {
    "transientBaseMs": 100,
    "dynamodbTransientBaseMs": 100,
    "throttlingBaseMs": 500,
    "capMs": 20000
  },
  "retryQuota": {
    "capacity": 500,
    "transientRetryCost": 10,
    "throttlingRetryCost": 5,
    "refundWithoutRetry": 1
  },
  "http": {
    "connectionTimeoutMs": null,
    "requestTimeoutMs": null,
    "socketTimeoutMs": null,
    "throwOnRequestTimeout": false,
    "keepAlive": true,
    "maxSockets": 50
  }
}
```

This task reads the machine's environment variables and `~/.aws/config` as they are. If you have set `max_attempts` or `retry_mode`, the values differ from the ones above, and they are the values a client really uses on your machine. The tests cut the settings off before asking.

With `AWS_NEW_RETRIES_2026=true vp run sdk:defaults`, `retries2026` becomes `true`, `maxAttempts.dynamodb` becomes 4, `backoff` becomes 50, 25 and 1000, and `transientRetryCost` becomes 14.

The log line per attempt is shown by the next task. Its output is in [Design and Build](/en/chapters/48-sdk/build.md).

```bash
vp run sdk:tour
```

`vp run sdk:credentials` shows where this machine's default credentials come from. As the previous page said, some settings make it reach AWS, so unlike the other two it is a `live` task.

After upgrading the SDK there is one thing to do: run the tests. If a default changed, `defaults.test.ts` fails; if the set of retried errors changed, `retry.test.ts`; if the order of the middleware changed, `attempt-log.test.ts`. When one fails, bring the constants in `src/defaults.ts` and the tables in these pages into line with the new values.

### What Is Not Reproduced Locally

The local server speaks plain HTTP. A real endpoint is HTTPS, so the time a TLS connection takes, and the behaviour of the HTTPS agent, are not exercised. That keep-alive and the limit of 50 are also set on the HTTPS agent was only read in the source. What `sdk:defaults` prints are the values of the plain-HTTP agent.

Nothing of a service's own behaviour is reproduced. Which errors the real DynamoDB returns with which status, which services return `x-amz-retry-after`, and what a request ID looks like cannot be learned from a script.

Behaviour inside a Lambda execution environment was not confirmed either. That credentials come from the environment variables, and that `AWS_NEW_RETRIES_2026` takes effect when set in a function's environment variables, are conclusions drawn from the source and the documentation.
