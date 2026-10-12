---
title: "25 Events: Deploy"
---

# 25 Events: Deploy

## Reading the stack

<!-- section: 25.stack -->

This page reads the stack that puts the parts from the [design and build page](/en/chapters/25-events/build.md) on AWS, then covers the steps to deploy, how to look into an event that did not arrive, and how to replay. The stack inherits chapter 08's, so only what is added is read.

### The stream and the bus

<<< @/examples/25-events/infra/lib/events-stack.ts{stream}

This one line is all that is added to the notes table. `NEW_AND_OLD_IMAGES` puts the item both before and after the change into each record. The earlier content is needed to see whether an update changed the version, and to know the ID of a note that was deleted.

The documentation has one warning. If a stream is disabled, a pipe that read it stays unusable even after the stream is enabled again, because the stream comes back with a new ARN. Treat the stream setting as something you do not touch once it is in.

<<< @/examples/25-events/infra/lib/events-stack.ts{bus}

The bus needs only a name. The archive always states how many days it keeps. Without that, events are kept without end, and so is the storage charge.

`AWS::Events::Archive` is a type cdkd 0.296.28 has no provider for. cdkd creates such types through Cloud Control API. That an archive can be created and deleted that way was not confirmed.

<<< @/examples/25-events/infra/lib/events-stack.ts{dead-letters}

Everything that could not be delivered goes to one queue. It has four kinds of sender: the pipe, the three rules, Lambda on behalf of the Timeline function, and the counter's queue. They share a queue so that a person has one place to look. The messages differ in shape by sender, and the second half of this page tells them apart.

<<< @/examples/25-events/infra/lib/events-stack.ts{projections}

The table the consumers write to is separate from the notes table. That way the consumers' roles need no permission on the notes table, and a consumer's write never shows up in the stream to pass through the pipe again. Written to the same table, the pipe's filter would be the only thing that breaks that loop. EventBridge's documentation also warns about loops in which a rule keeps triggering itself.

What this table holds can be rebuilt from the notes. That is why it is left to be deleted with the stack.

### The pipe

<<< @/examples/25-events/infra/lib/events-stack.ts{shape}

<<< @/examples/25-events/infra/lib/events-stack.ts{pipe}

The pipe reads the stream, calls the function, and puts events on the bus with a role of its own. The role allows those three things and sending to the dead-letter queue.

Exactly one statement in this stack has `*` as its resource, and it is here. `dynamodb:ListStreams` is an action for which IAM defines no resource type, so there is no narrower way to write it. It is included because the Pipes documentation lists it among the actions required.

The role's trust policy says only that `pipes.amazonaws.com` may assume it. Chapter 08 narrowed when the Scheduler's role could be assumed with `aws:SourceArn`. No example of the same condition was found on the permissions page of the Pipes documentation, so none is set here.

`TRIM_HORIZON` for `startingPosition` reads from the oldest record still in the stream. With `LATEST`, the documentation says, changes made during the few minutes it takes to create the pipe can be missed. `TRIM_HORIZON` has another side. Add a pipe later to a table whose stream is already running, and up to 24 hours of records still in the stream flow through at once. This stack creates the stream and the pipe together, so that does not arise.

### The three rules and what lies beyond

<<< @/examples/25-events/infra/lib/events-stack.ts{timeline}

The Timeline function has two layers of retry. They are different things, set in different places.

The `retryPolicy` on the rule's target is for when EventBridge cannot invoke the function: Lambda is throttling, say, or the permission is missing. The default is to retry for 24 hours and up to 185 times. Here it is one hour and 8 times. An event that still cannot be handed over goes to the queue in the target's `deadLetterConfig`. According to the documentation, errors such as a missing permission or a target that does not exist are not retried and go to the queue at once.

EventBridge invokes the function asynchronously. Once Lambda has accepted the invocation, the delivery has succeeded as far as EventBridge is concerned. If the function then throws, EventBridge has no part in it. From there it is Lambda's job: Lambda tries again after one minute, and again two minutes after that. If that fails too, it sends the event and a record of the failure to the on-failure destination written in `TimelineAsync`.

Setting only the rule's DLQ and expecting the function's failures to land there is a common mistake. A failure inside the function does not go to the rule's DLQ.

Only this rule may invoke the function. `TimelineInvoke` writes that into the function's resource policy.

<<< @/examples/25-events/infra/lib/events-stack.ts{counter}

On the counter's side the rule's target is a queue. EventBridge's delivery ends when the message is in the queue. Beyond that it is chapter 08's setup: the visibility timeout is six times the function's timeout, and a message received five times without being deleted moves to the dead-letter queue.

<<< @/examples/25-events/infra/lib/events-stack.ts{send-from}

For EventBridge to put a message in a queue, the queue needs a policy. The condition `aws:SourceArn` carries the rule's ARN and allows sending from this rule alone. Without the condition, any rule in any account could send to this queue, as long as it went through EventBridge.

<<< @/examples/25-events/infra/lib/events-stack.ts{rejections}

The rejections rule does not hand the event over as it is. An input transformer rebuilds it first. `inputPathsMap` gives names to five values in the event, and `inputTemplate` has them filled in at each `<name>`. What the topic's subscribers receive is JSON with six fields: `kind`, `owner`, `noteId`, `attachmentId`, `reason`, and `at`.

`<owner>` has no quotation marks in the template because, as the documentation says, EventBridge adds them to a variable that holds a string. It also says that a variable whose path is not in the event is not created and disappears from the output. An event without `reason` would break the template as JSON. That is why the event's schema insists that a rejection has a reason.

The reason to reshape is to keep the contracts apart. The topic's subscribers need not know the shape of this application's events. When the event's shape changes, this template is the only thing to fix.

The topic's policy has the form of the example in EventBridge's documentation, with no condition. Whether it can be narrowed with `aws:SourceArn` as the queue's is could not be read from the documentation, so nothing was added.

For now the topic has one subscriber, a queue named `RejectionInbox`. Another way of receiving the notice is one more subscription. The rule, the template, and the side that makes the events all stay as they are. `rawMessageDelivery` is on, so what lands in the queue is the JSON above and nothing else. With it off, SNS wraps that JSON in fields of its own. To receive by email, add a subscription for an email address and open the link in the confirmation message that arrives. This chapter's stack does not include one.

<<< @/examples/25-events/infra/lib/events-stack.ts{dead-letter-policy}

### Next to chapter 08's stack

<<< @/examples/25-events/infra/lib/events-stack.ts{stand-apart}

Chapter 08 gave fixed names to three things: the bucket, the schedule, and the sign-in domain. A second stack cannot be created with the same names, so they are replaced with this chapter's. The bucket's name is also written inside chapter 08's queue policy, and that is overridden to match. A test checks that `aih-async` is left nowhere in the template.

<<< @/examples/25-events/src/timeline-lambda.ts{handler}

<<< @/examples/25-events/src/counter-lambda.ts{handler}

<<< @/examples/25-events/src/env.ts{env}

```bash
vp run events:infra:synth
```

The synth was run locally. The template holds 31 resource types: chapter 08's 24 and seven more. Of the seven, cdkd 0.296.28 has a provider for six: `AWS::Events::EventBus`, `AWS::Events::Rule`, `AWS::Pipes::Pipe`, `AWS::SNS::Topic`, `AWS::SNS::TopicPolicy`, and `AWS::SNS::Subscription`. The remaining one, `AWS::Events::Archive`, goes through Cloud Control API.

## Deploying and checking

<!-- section: 25.deploy -->

Nothing from here on was run. What is prepared is the steps and the tasks.

```bash
vp run events:infra:diff
vp run events:infra:deploy
vp run events:smoke
```

`events:smoke` writes one note into the notes table with your credentials and waits for the timeline entry and the count to appear. It then updates the note and deletes it, and checks that the timeline follows and the count returns to 0. Last, it puts a file that is not an image into the uploads bucket and waits for the notice to reach `RejectionInbox`. That is one lap through S3, chapter 08's worker, the stream, the pipe, the bus, SNS, and SQS. It waits up to 120 seconds at each stage.

Most of what this chapter could not confirm shows in that run: that the pipe makes events from the array the function returns, that `$.type` becomes `detail-type`, that the archive can be created through Cloud Control API, that the four kinds of sender can send to an encrypted queue, and that the input transformer's output lands in the queue as it is.

The drift check is as in the earlier chapters.

```bash
vp run events:infra:drift
```

## When something did not arrive, and sending it again

<!-- section: 25.operate -->

### Reading the dead-letter queue

```bash
vp run events:status
```

`events:status` prints roughly how many events are in the archive, roughly how many messages wait in each of the three queues, and where up to ten messages at the head of the dead-letter queue came from. It moves no message.

<<< @/examples/25-events/src/dead-letter.ts{dead-letter}

The dead-letter queue has four kinds of sender, and each leaves a different shape behind.

- An event a rule could not hand over has message attributes added by EventBridge. `RULE_ARN` says which rule, and `ERROR_CODE` says why
- An event the Timeline function failed on all three times is wrapped in Lambda's record. `requestPayload` is the original event, and `requestContext` holds the number of attempts
- A message moved from the counter's queue is the event as it was
- What the pipe set aside is none of the above. The Pipes documentation says that what is sent describes the failed batch, and its shape was not confirmed in this chapter

All of these shapes were written from the examples in the documentation, not from messages actually received.

Once you know where a message came from, think in the order chapter 08 gave. Was the cause temporary and is it gone, is it a mistake in code or settings that is still there, or can the event itself not be read? Only the first, and the second once fixed, may be sent again.

### Replaying

There are two ways to send something again. A message moved from the counter's queue can go back to its queue with chapter 08's `StartMessageMoveTask`. Everything else is replayed from the archive.

```bash
vp run events:replay -- --minutes 60 --rule timeline
vp run events:replay -- --minutes 60 --rule timeline --yes
vp run events:replay -- --describe <replay name>
```

The first line only prints what would be replayed. A replay starts only with `--yes`.

<<< @/examples/25-events/src/replay-plan.ts{plan}

The part that decides what a replay covers is a function that does not call AWS, and it has tests. It refuses a span older than the archive keeps, and when the span includes the last 10 minutes it says that those events may not be in the archive yet. Without `--rule`, the events go to every rule.

There are things to check before starting a replay.

- Is every consumer it goes to idempotent? This chapter's timeline and counter are, and rejections takes no replay. If rules were added since, look at those too
- Did you name with `--rule` only the consumer you meant to repair? Is there a reason to send to all of them?
- Does the span fit within the days the archive keeps? Is it shorter than the life of the counter's markers (30 days)?
- How many events are there? A replayed event is billed as a custom event once more, and the consumers run once more

`--describe` shows how far a replay has got. According to the documentation, at most ten replays can be active per account and Region (checked on 2026-10-13).

That a replay reaches only the rules it names, that a replayed event reaches a function or a queue with `replay-name` on it, and that the rejections rule lets none through were all not confirmed on AWS. Ten minutes after `events:smoke`, run a replay with `--rule timeline` and look for the name in the `replay` field of the Timeline log, and check that the timeline entries did not change: that settles the first two. For the third, replay without `--rule` and see that nothing is added to `RejectionInbox`.
