---
title: "08 Queue: Deploy"
---

# 08 Queue: Deploy

## Getting ready for AWS

<!-- section: 08.infra -->

This page reads the stack that puts the worker and the housekeeping from the [first page](/en/chapters/08-async.md) on AWS, then covers the deploy steps and what to look at when messages pile up on the queue. The stack extends chapter 07's, so only the added parts are read here.

### The queues, and the way in

<<< @/examples/08-async/infra/lib/async-stack.ts{queues}

<<< @/examples/08-async/infra/lib/async-stack.ts{queue-policy}

A queue policy is the document of permissions attached to a queue. Only S3 may put messages on this queue, and only notifications about this bucket that come from within this account. The two conditions, `aws:SourceArn` and `aws:SourceAccount`, are the same as in the documentation's example. Without them, anyone could put messages on this queue from their own bucket, as long as the messages went through S3.

The DLQ has no `Allow` at all. A separate setting, the redrive allow policy, decides which queues may use this DLQ. By default every queue may, and this chapter leaves the default.

### Why the bucket's name is fixed

<<< @/examples/08-async/infra/lib/async-stack.ts{bucket-name}

<<< @/examples/08-async/infra/lib/async-stack.ts{notification}

This part is a little involved, because of the order in which the resources have to be created.

When S3 receives a notification configuration, it checks that it really can send to the destination queue, so the queue policy has to exist before the bucket. But the queue policy contains the bucket's ARN, and with an automatically generated bucket name the ARN is not known until the bucket exists. The bucket waits for the policy, and the policy waits for the bucket. The CloudFormation documentation warns about this cycle by name.

CDK's `bucket.addEventNotification` breaks the cycle with a custom resource: after both the bucket and the policy exist, a separate Lambda function writes the notification configuration. This chapter does not use it, because it adds one more function, that function needs permission to rewrite the bucket's configuration, and the notification configuration disappears from the template.

The chapter fixes the bucket's name instead. With a known name, the ARN can be written without referring to the bucket, so there is no cycle.

This choice gives something up. No two AWS accounts in the world can have a bucket of the same name. The account ID is part of this name, so a clash is unlikely, but it is not impossible. A bucket with a fixed name is also harder to change in ways that require re-creating it, such as moving it to another Region.

Another option is to send S3's notifications to EventBridge and have an EventBridge rule put them on the queue. The bucket then only says that it sends to EventBridge, so there is no cycle. In exchange, the shape of the events changes, and so does the service in between. This chapter has not tried it.

The bucket sends notifications only for creates and deletes of keys that start with `u/`.

### The worker, and how it is called

<<< @/examples/08-async/infra/lib/async-stack.ts{worker}

The worker's role is separate from the API function's role. It allows three operations for reading the queue, reading objects under `u/` and removing their tags, and three operations on the table. It has no permission to delete an object, because deleting is housekeeping's job.

Lambda, not your code, goes and reads the queue, and it uses this function's role to do so. The managed policy AWS provides (`AWSLambdaSQSQueueExecutionRole`) allows the same three operations, but on every queue. This chapter narrows them to one queue.

<<< @/examples/08-async/src/worker-lambda.ts{handler}

<<< @/examples/08-async/src/env.ts{env}

<<< @/examples/08-async/infra/lib/async-stack.ts{mapping}

An event source mapping is the setting that tells Lambda to read this queue and hand the messages to this function. It decides three things.

`batchSize` is 10, the most messages handed over in one invocation.

`maxConcurrency` is 2, the limit on how many workers run at once for this queue, and 2 is the smallest value allowed. With nothing set, Lambda keeps adding workers as long as messages are waiting. According to the documentation it starts with five and adds up to 300 a minute, up to 1,250. More workers send that many more requests to whatever the worker writes to (DynamoDB) and reads from (S3).

`reportBatchItemFailures` turns on the partial batch response described on the [first page](/en/chapters/08-async.md). The documentation explains that a function can return a partial success only once this is specified. If you forget it, the list the worker returns should go unused.

There is one more way to hold down a function's concurrency: reserved concurrency, set on the function. The documentation stresses that the two are separate settings. If reserved concurrency is the smaller of the two, Lambda cannot hand the messages it received to the function and is throttled. Such a message goes back to the queue unprocessed, with its receive count one higher.

### Housekeeping and the schedule

<<< @/examples/08-async/infra/lib/async-stack.ts{housekeeping}

Housekeeping has the third role. It allows listing and deleting objects, removing tags, and reading and deleting in the table. It cannot touch the queues.

The timeout is 15 minutes, Lambda's maximum. This function looks at the bucket's objects one after another, so it takes longer as their number grows.

<<< @/examples/08-async/infra/lib/async-stack.ts{schedule}

EventBridge Scheduler is a service that calls one AWS API at a set time or interval. The permission it uses for the call is the schedule's execution role. That role is separate from the function's execution role: Scheduler uses it to call the function on your behalf.

All this role can do is invoke the housekeeping function, and only a schedule in this account's default schedule group can use it. The documentation specifies that the ARN in the condition must be a schedule group, not an individual schedule.

`retryPolicy` covers the case where Scheduler fails at the call itself. It retries up to three times within fifteen minutes and then gives up on that run, because the next one comes an hour later.

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

None of the steps from here on have been run. The steps and the tasks are prepared, and that is all.

```bash
vp run async:infra:diff
vp run async:infra:deploy
vp run async:smoke
```

`async:smoke` puts a small PNG straight into the bucket with your credentials and waits for the worker's record to appear in the table. It then replaces the same key with something that is not an image, and checks that the record turns to "rejected" and that the `sequencer` grew. Last, it deletes the object and waits for the record to go. The check makes one lap around S3, SQS, Lambda, and DynamoDB, and waits at most 90 seconds at each stage.

To use the stack from a browser too, follow the same steps as in chapter 07.

```bash
vp run async:user:create you@example.com
vp run async:publish
vp run async:smoke:web
```

If you put the access token you get by signing in into the environment variable `AIH_ACCESS_TOKEN` and run `async:smoke`, it checks a form upload as well. After finishing the upload, it sends the same form again and waits for the pending tag to come off. This run settles the most important thing this chapter has not checked: whether a POST event carries a `sequencer`.

The schedule starts its first run as soon as it is created. The documentation says a rate schedule with no start date behaves that way.

Checking for drift works as in the earlier chapters.

```bash
vp run async:infra:drift
```

## When it backs up, when it falls over

<!-- section: 08.operate -->

### The queue grows

When uploads suddenly increase and the worker cannot keep up, nothing fails. Messages just pile up on the queue. At most two workers run at once, so requests to DynamoDB and S3 do not suddenly increase either. The delay shows up as inspection results that take longer to appear. This is backpressure: a queue absorbs the difference in flow as the length of a waiting line.

A queue can absorb it only up to the retention period, though. This chapter's queue keeps a message for 4 days. A message still unprocessed after 4 days is deleted, and it does not go to the DLQ. So the number to watch is the age of the oldest message (`ApproximateAgeOfOldestMessage` in CloudWatch) more than the length of the queue. [Chapter 19](/en/chapters/19-observability.md) shows how to put an alarm together.

The next question is what limits how much comes into the queue.

Only S3 can send to this queue, and only about things that happened under `u/` in this one bucket. Putting an object there takes a permit. Permits come from chapter 07's API, which has a throttle of 10 requests a second and hands one person at most 100 a day. An upload causes one event for the create and one more for the delete or the lifecycle expiration. In ordinary use, one person can cause a few hundred events a day, which is not more than the worker can keep up with.

One way in is not limited. As chapter 07 explained, a permit works any number of times for 5 minutes. Each time the same form is sent again, S3 replaces the object and sends one more create event. The resending does not go through the API, so neither the throttle nor the limit of 100 a day applies. If a signed-in user keeps sending the same form, the queue grows.

When that happens, some things are protected and some are not.

- The workers do not multiply. At most two run at once. At 200 ms a message, the assumption from ["What it costs"](/en/chapters/08-async/wrap.md), they get through about 10 a second, around 860,000 a day
- Requests to DynamoDB do not multiply either. With two workers, writes and reads go only as far as two workers take them. The table also has the same request unit limits as in chapter 07
- What the workers cannot get to is gone after 4 days. On the assumption above, they get through about 3.46 million messages in 4 days. Anything queued beyond that is deleted without being processed. Those images were never inspected
- The bill follows the number of events that arrive. Nothing stops messages from being put on the queue

A queue absorbs a difference in flow, but it does not limit the flow itself. Limiting is the entrance's job.

### Looking at the DLQ

```bash
vp run async:queue
vp run async:logs
```

`async:queue` shows roughly how many messages are waiting on the two queues, and the contents of up to the first ten in the DLQ. It moves nothing. It receives with a visibility timeout of 0, so the messages stay visible after you look, although their receive count does go up.

If there is a message in the DLQ, first find the `message failed` line for that key in the worker's log. The line gives the reason for the failure, which is one of three kinds.

- The reason was temporary (a passing error from DynamoDB or S3, permissions still propagating right after a deploy) and is over
- The reason is a mistake in code or configuration, and it is not fixed yet
- The message itself cannot be read

Only messages of the first kind should be moved back as they are. Move the second kind back after the fix. The third kind would only fail the same way again.

```bash
vp run async:queue --redrive
```

This command moves the DLQ's messages back to the source queue, which is called a redrive. According to the documentation, a moved message is treated as a new message: it gets a new ID, and its retention period starts over. You cannot select or rewrite messages during a redrive. All of them go back.

If a moved message turns out to be an event that was already handled, nothing happens. That is why the worker was built to be idempotent.
