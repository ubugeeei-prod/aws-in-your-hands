---
title: "08 Queue: Deploy"
---

# 08 Queue: Deploy

## Getting ready for AWS

<!-- section: 08.infra -->

### The queues, and the way in

<<< @/examples/08-async/infra/lib/async-stack.ts{queues}

<<< @/examples/08-async/infra/lib/async-stack.ts{queue-policy}

A queue policy is the document of permissions attached to a queue. Only S3 may put messages on this queue, and only on behalf of this bucket, from within this account. The two conditions, `aws:SourceArn` and `aws:SourceAccount`, are the same as in the documentation's example. Without them, anyone could put messages on this queue from their own bucket by going through the S3 service.

The DLQ has no `Allow` at all. Which queues may use this DLQ is decided by a separate setting, the redrive allow policy. Its default is "allow every queue", and this chapter leaves the default.

### Why the bucket's name is fixed

<<< @/examples/08-async/infra/lib/async-stack.ts{bucket-name}

<<< @/examples/08-async/infra/lib/async-stack.ts{notification}

This part is a little tangled.

When S3 receives a notification configuration, it checks that it really can send to the destination queue. So the queue policy has to exist before the bucket. But the queue policy contains the bucket's ARN. With an automatically generated bucket name, the ARN is not known until the bucket exists. The bucket waits for the policy, and the policy waits for the bucket. The CloudFormation documentation warns about this cycle by name.

CDK's `bucket.addEventNotification` solves it with a custom resource: after both the bucket and the policy exist, a separate Lambda function writes the notification configuration. This chapter does not use it. It adds one more function, that function needs permission to rewrite the bucket's configuration, and the notification configuration disappears from the template.

Instead, the bucket's name is fixed. With a known name, the ARN can be written without referring to the bucket. No cycle.

Something was given up too. No two AWS accounts in the world can have a bucket of the same name. The account ID is part of this one, so a clash is unlikely, but not impossible. And a bucket with a fixed name is harder to change in ways that require re-creating it (moving it to another Region, for example).

Another option is to send S3's notifications to EventBridge and have an EventBridge rule put them on the queue. The bucket only says "send to EventBridge", so there is no cycle. The shape of the events changes, and so does the service in between. This chapter has not tried it.

What is notified is creates and deletes of keys starting with `u/`, and nothing else.

### The worker, and how it is called

<<< @/examples/08-async/infra/lib/async-stack.ts{worker}

The worker's role is separate from the API function's role. Three operations for reading the queue, reading objects under `u/` and removing their tags, and three operations on the table. It has no permission to delete an object. Deleting is housekeeping's job.

It is Lambda, not your code, that goes and reads the queue. The role it uses for that is this function's role. The managed policy AWS provides (`AWSLambdaSQSQueueExecutionRole`) allows the same three operations, but on "every queue". Here they are allowed on one queue.

<<< @/examples/08-async/src/worker-lambda.ts{handler}

<<< @/examples/08-async/src/env.ts{env}

<<< @/examples/08-async/infra/lib/async-stack.ts{mapping}

An event source mapping is the setting "Lambda reads this queue and hands it to this function". Three things are decided here.

`batchSize` is 10: the most messages handed over in one invocation.

`maxConcurrency` is 2: the limit on how many workers run at once for this queue. It is the smallest value allowed. With nothing set, Lambda keeps adding workers as long as messages are waiting. According to the documentation it starts with five, and adds up to 300 a minute, up to 1,250. More workers means just as many more requests to whatever the worker writes to (DynamoDB) and reads from (S3).

`reportBatchItemFailures` turns on the partial batch response from earlier. The documentation explains that a function can return a partial success only once this is specified. Forget it, and the list the worker returns should go unused.

There is another way to hold down a function's concurrency: reserved concurrency, set on the function. The documentation stresses that the two are separate settings. If reserved concurrency is the smaller one, Lambda cannot hand the messages it received to the function and is throttled. Such a message goes back to the queue unprocessed, with its receive count one higher.

### Housekeeping and the schedule

<<< @/examples/08-async/infra/lib/async-stack.ts{housekeeping}

Housekeeping's role is a third role. Listing and deleting objects, removing tags, and reading and deleting in the table. It cannot touch the queues.

The timeout is 15 minutes, Lambda's maximum. This function looks at the bucket's objects one after another, so it takes longer as their number grows.

<<< @/examples/08-async/infra/lib/async-stack.ts{schedule}

EventBridge Scheduler is a service that calls one AWS API for you at a set time or interval. The permission it uses for the call is the schedule's execution role. It is a different thing from a function's execution role: a role for "Scheduler calling the function on your behalf".

All this role can do is invoke the housekeeping function. And the only thing that can use this role is a schedule in this account's default schedule group. The documentation specifies that the ARN in the condition must be a schedule group, not an individual schedule.

`retryPolicy` is the retry for when Scheduler fails at the call itself. Up to three times, within fifteen minutes. If that fails, that run is given up. The next one comes an hour later.

### What the tests look at

The tests check the following on the template. Synth runs once, at the top of the file.

- The queue policy has exactly one `Allow`: the principal is S3, the action is `sqs:SendMessage`, and the conditions are the bucket's ARN and the account
- The queue policy does not refer to the bucket resource, and the bucket is created after the queue policy
- The notification configuration is written directly in the template, and there is no resource whose type starts with `Custom::`
- The visibility timeout is six times the worker's timeout, and the DLQ keeps messages longer than the source queue
- The event source mapping has a batch of 10, a concurrency of 2, and `ReportBatchItemFailures`
- The actions of the worker's and housekeeping's roles are exactly the ones described above, with no `*`
- Only Scheduler can use the schedule's role, and all it can do is invoke the housekeeping function

The stack uses 24 resource types: chapter 07's 19 and five more. For the five added (`AWS::SQS::Queue`, `AWS::SQS::QueuePolicy`, `AWS::Lambda::EventSourceMapping`, `AWS::Lambda::EventInvokeConfig`, `AWS::Scheduler::Schedule`), the source at the `v0.296.28` tag confirmed that the pinned cdkd has a dedicated implementation of each. The same source confirmed that the `AWS::S3::Bucket` implementation handles `BucketName` and `NotificationConfiguration`.

## Deploying and checking

<!-- section: 08.deploy -->

From here on, nothing has been run. The steps and the tasks are prepared, and that is all.

```bash
vp run async:infra:diff
vp run async:infra:deploy
vp run async:smoke
```

`async:smoke` puts a small PNG straight into the bucket with your credentials and waits for the worker's record to appear in the table. It then replaces the same key with something that is not an image, and checks that the record turns to "rejected" and that the sequencer grew. Last, it deletes the object and waits for the record to go. It is one lap around S3, SQS, Lambda, and DynamoDB. Each wait is at most 90 seconds.

To use it from a browser too, the steps are chapter 07's.

```bash
vp run async:user:create you@example.com
vp run async:publish
vp run async:smoke:web
```

Put the access token you get by signing in into the environment variable `AIH_ACCESS_TOKEN` and run `async:smoke`, and it checks a form upload as well. After finishing, it sends the same form again and waits for the pending tag to come off. The most important of this chapter's "not yet" items (whether a POST event carries a sequencer) is settled here.

The schedule starts its first run as soon as it is created. The documentation says a rate schedule with no start date behaves that way.

Checking for drift is the same as before.

```bash
vp run async:infra:drift
```

## When it backs up, when it falls over

<!-- section: 08.operate -->

### The queue grows

What happens when uploads suddenly increase and the worker cannot keep up?

Nothing fails. Messages just pile up on the queue. At most two workers run at once, so requests to DynamoDB and S3 do not suddenly increase either. The delay shows up as "inspection results take longer to appear". This is backpressure. A queue takes on the difference in flow as the length of a waiting line.

It can only take it on up to the retention period, though. This chapter's queue keeps a message for 4 days. A message still unprocessed after 4 days is gone. It does not go to the DLQ either. The number to watch is not the length of the queue but the age of its oldest message (`ApproximateAgeOfOldestMessage` in CloudWatch). How to put an alarm together is in [chapter 19](/en/chapters/19-observability.md).

### Looking at the DLQ

```bash
vp run async:queue
vp run async:logs
```

`async:queue` shows roughly how many messages are waiting on the two queues, and the contents of up to the first ten in the DLQ. It moves nothing. It receives with a visibility timeout of 0, so the messages stay visible after you look (only their receive count goes up).

If there is a message in the DLQ, first find the `message failed` line for that key in the worker's log. The reason is written there.

- The reason was temporary (a passing error from DynamoDB or S3, permissions still propagating right after a deploy) and is over
- The reason is a mistake in code or configuration, and it is not fixed yet
- The message itself cannot be read

Only the first kind should be moved back. The second, after it is fixed. The third would only do the same thing again.

```bash
vp run async:queue --redrive
```

This moves the DLQ's messages back to the source queue (a redrive). According to the documentation, a moved message is treated as a new message: it gets a new ID, and its retention period starts over. Messages cannot be selected or rewritten during a redrive. All of them go back.

If a moved message turns out to be an event that was already handled, nothing happens. That is what all of the above was for.
