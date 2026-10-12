---
title: "29 Lambda Tuning: Deploy"
---

# 29 Lambda Tuning: Deploy

## Deploying and measuring

<!-- section: 29.deploy -->

From here you deploy to AWS and take the numbers from Lambda itself. The steps on this page have not yet been run against real AWS, and no example output is shown.

```bash
vp run tune:infra:diff
vp run tune:infra:deploy
```

By default the memory is 256 MB, with no reserved and no provisioned concurrency. In that state nothing is charged while the stack sits there.

Send some requests.

```bash
vp run tune:smoke
```

`tune:smoke` creates one note, reads it 20 times, and deletes it. For each call it prints the response time as seen from your machine and the `x-request-id`. Right after a deploy, the first call should land on a new environment. The times printed here include the network between you and the Tokyo Region.

Summarize Lambda's own records.

```bash
vp run tune:report --minutes 15
```

`tune:report` reads the function's log group for the given time and prints, in the same shape as on the [first page](/en/chapters/29-lambda-tuning.md), the number of cold starts, the initialization and handler times, the memory used, and the billed time. According to the documentation, logs can take 5 to 10 minutes to show up. If nothing is printed, wait a little and try again.

Read it in this order.

- `cold starts` and `initialization`. How long initialization takes tells you how much reviewing the bundle and the initialization code is worth
- The difference between `handler, cold` and `handler, warm`. If only the first invocation is slow, most of that difference should be setting up the connection
- `memory`. If the most that was used is close to the setting, add memory

To compare memory settings, redeploy with a value.

```bash
vp run tune:infra:deploy -c memorySize=512
vp run tune:smoke
vp run tune:report --minutes 15
```

When comparing, keep the time ranges of the two `tune:report` runs from overlapping. With 20 invocations, the p95 is decided by one or two values. That is enough to see a tendency; for numbers you would hand to someone else, take them again with a larger `--count`.

### Adding concurrency settings

Before adding reserved or provisioned concurrency, check the account's limit.

```bash
aws lambda get-account-settings
```

`ConcurrentExecutions` is the account's limit. You can reserve what is not yet reserved, less the 100 that must remain; if that is not enough, the next deploy is refused with a concurrency error.

```bash
vp run tune:infra:deploy -c reservedConcurrency=5
vp run tune:infra:deploy -c reservedConcurrency=5 -c provisionedConcurrency=1
```

From the second command on, **you are billed by time.** One environment at 256 MB is 2.83 a month, about 0.09 a day. When you are done checking, redeploy without `-c provisionedConcurrency`, or delete the stack.

With provisioned concurrency the stack gains a version and an alias, and the API calls the alias. Preparing the environments takes time. They are ready when `Status` in the following command's output is `READY`. The function name is the stack output `FunctionName`.

```bash
aws lambda get-provisioned-concurrency-config --function-name <FunctionName> --qualifier live
```

The initialization of the prepared environments appears in the log as records of type `platform.initReport`. `tune:report` counts these in its `initialization` row as well.

For cdkd, the source of the pinned version (0.296.28) was read to see how each resource type is handled. Every type the default stack uses has a dedicated implementation. `AWS::Lambda::Version` and `AWS::Lambda::Alias`, which are added when provisioned concurrency is requested, have none and go through Cloud Control API. Both types are on Cloud Control API's list of supported resources, but whether cdkd can actually create them has not been checked.

The drift check is the same as in earlier chapters.

```bash
vp run tune:infra:drift
```

Memory and timeout are settings that one click in the console changes. Change one as an experiment and forget to change it back, and the template and the real thing disagree. `tune:infra:drift` finds that difference.
