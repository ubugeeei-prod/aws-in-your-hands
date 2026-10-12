---
title: "25 Events: Costs, Pitfalls, and Cleanup"
---

# 25 Events: Costs, Pitfalls, and Cleanup

For the setup built from the [first page](/en/chapters/25-events.md) through the [deploy page](/en/chapters/25-events/deploy.md), this page covers how it differs from the nearest parts on Cloudflare and Vercel, what it costs, where it tends to go wrong, and how to clean up.

## If you're coming from Cloudflare or Vercel

Both have parts that carry messages. What follows is as far as their official documentation was checked on 2026-10-13.

Cloudflare Queues, as chapter 08 compared, is the part close to SQS. Delivery is at least once, and nothing promises that messages arrive in the order they were sent. What matters for this chapter is a sentence in the documentation: each queue can have only one active consumer. To hand the same event to three receivers, the sending Worker writes to three queues, once each. The sender, in other words, knows its receivers. With three receivers, all written by one team, that is enough, and it takes far fewer parts than this chapter.

Event subscriptions in Queues sound close and are something else. They deliver to a queue what Cloudflare's own products did inside your account, from eleven sources including R2, Workers KV, Workers AI, Workers Builds, and Workflows. On AWS that corresponds to the events AWS services put on the default event bus. It is not a part for putting your application's own events somewhere and handing them out by content. The example events carry `eventSchemaVersion`, and keeping the version as a field is the same idea as in this chapter.

Nothing matching rules that route by content, an input transformer, or archive and replay was found on Cloudflare in the pages read. Built by hand, a rule is an `if` in a Worker, and a replay is code that reads back events you wrote to R2.

Vercel Queues is the part nearest to this chapter. It is in beta and available on every plan. A topic is an append-only log, and a message goes to every consumer group subscribed to the topic. Consumer groups are independent of each other, and a group that joins later can read back the messages that have not expired. Delivery is at least once, and the documentation tells you to make consumers idempotent. A publish can also carry an idempotency key so that duplicates are dropped.

The differences are in retention and in how messages are handed out. A Vercel Queues message is kept from 60 seconds to 7 days, 24 hours by default. Nothing about rules that choose a destination by a message's content, or about a guarantee of order, was written on the pages read. They were not confirmed.

If your application lives entirely on Vercel or Cloudflare and has a handful of receivers, staying there is the plain choice. This chapter's setup adds more than ten parts. That is worth it when receivers multiply across teams and accounts, when each receiver wants its own retries and its own place for failures, when AWS services or people (email) are among the destinations, or when you want a way to send past events again.

## Costs

Amounts are in USD for the Tokyo Region, before tax. The inputs and unit prices are in [Pricing calculations](/en/reference/pricing.md).

Five unit prices are new. A custom event costs USD 1.00 per million events put on the bus, counted once per 64 KB. Delivery to a target in the same account is not charged. Pipes costs USD 0.50 per million requests that passed the filter. The archive costs USD 0.13 per GB taken in and USD 0.025 per GB-month stored. DynamoDB Streams reads are USD 0 for the first 2.5 million a month and USD 0.000000228 each beyond that. SNS is USD 0 for the first million requests a month, and delivery to a queue has no per-message charge.

The idle month first. Nothing in this setup is billed by the hour, but one thing runs when nothing is happening: the pipe. It polls a shard of the stream four times a second, 10,512,000 times a month. DynamoDB's pricing page bills each `GetRecords` call on a stream and says that calls from Lambda triggers and from global tables are free. Pipes is not among those exceptions.

Assuming the calls are billed, an idle month costs **USD 1.83**. It also assumes one shard and a polling rate that does not change over the month. This was not checked on a bill. They may turn out not to be billed, and with more shards the amount grows accordingly.

Then a month of use: 10,000 note changes (6,000 created, 3,000 updated, 1,000 deleted) and 10,000 inspections, 100 of them rejected. This is what is added to chapter 08's example.

| Item | List price |
| --- | --- |
| Stream reads (10,512,000) | 1.83 |
| Pipes requests (20,000) | 0.01 |
| Custom events (20,000) | 0.02 |
| Archive, taking in and storing | 0.00 |
| Three functions (37,000 runs, 100 ms each assumed) | 0.02 |
| DynamoDB writes (38,000 units) | 0.03 |
| SQS requests (21,100) | 0.01 |
| SNS publishes (100) | 0.00 |
| Logs | 0.01 |
| Subtotal | **1.93** |

That is USD 1.93, and 1.89 after the monthly free allowances. Leaving the stream reads aside, handing 20,000 events to three consumers costs about 10 cents. The counter's writes are many for the number of events because a transactional write is 2 units per KB, and it writes two items.

**What grows with the number of events is small, and what is charged for merely being there is larger.** At this size, that is how it comes out. With a hundred times the events, the part that grows with them is the larger one.

A replay costs something too. Replaying seven days of the example above, 4,667 events, to every rule is USD 0.02 at list price. A replayed event is billed as a custom event once more, and the consumers run once more. A refused write was counted as a write.

Deleting the stack removes the pipe, the bus, the archive, and the queues, and this chapter's charges stop.

### If someone hammers it

Nothing this chapter adds has an entrance that can be called from outside. Only a write to the table puts anything in the stream, and only the pipe's role can put events on the bus. What arrives from outside is a request that came through the entrances of chapters 07 and 08.

The ceilings on what this chapter adds are these.

- The pipe moves one record at a time per shard. Events are not normally made faster than the notes API's throttle allows (10 requests a second)
- The counter's function runs at most two at once. The Timeline function has no concurrency limit in this chapter, and shares the account's concurrency with every other function
- The projections table has a ceiling of 20 read units and 20 write units a second. The counter uses 4 units per event, so past 5 events a second DynamoDB refuses. A refused message returns to the queue and moves to the dead-letter queue on its fifth receive
- The charge per event has no ceiling

The thing to watch is a loop. Change a consumer to write back to the notes table, and that write appears in the stream, passes the pipe, and reaches the consumer again. Only the pipe's filter would stop it. The consumers in this chapter write to another table and nowhere else.

## Where it tends to go wrong

| If this happens | Look here |
| --- | --- |
| The deploy fails creating the archive | `AWS::Events::Archive` goes through Cloud Control API. See the steps for resuming in the verification notes at the end of this page |
| The deploy says the bucket name is already taken | Check whether a bucket named `aih-events-uploads-<account ID>` is still around |
| A note is written and nothing happens | Look at the pipe's state. The documentation says Pipes disables a pipe automatically after continued 4xx errors such as missing permissions |
| The Shape log says `shaped` and no consumer runs | Check the pipe's target setting (`$.type`) and the `source` in the rules' patterns |
| Timeline runs and counter does not | Look at the counter's queue with `vp run events:status`. If messages wait there, it is the event source mapping or the function. If it is empty, it is the rule or the queue policy |
| The dead-letter queue has a message whose `ERROR_CODE` is `NO_PERMISSIONS` | Check that the target's resource policy (the function's permission, the queue policy, the topic policy) names that rule's ARN |
| The function fails and nothing lands in the rule's DLQ | A failure inside the function is retried by Lambda and goes to the on-failure destination. The rule's DLQ receives only events that could not be invoked |
| Later changes in the stream never become events | See whether the function keeps failing on an earlier record. This chapter's pipe sets a record aside after three tries, but the default is without limit |
| A count went up after a replay | A replay reached a consumer that is not idempotent. Rebuild the count by counting the notes |
| A replay does not bring recent events | An event takes a while to reach the archive. Wait 10 minutes |
| A message on the topic does not read as JSON | Check that no path in the input transformer points at a field the event lacks. A missing variable disappears from the output |
| The pipe stopped working after the stream was disabled | A stream enabled again has another ARN. Create the pipe anew |

## Before production

- **Put an alarm on the dead-letter queue.** Four kinds of sender share one queue. Be told when it is no longer empty. The pipe's lag would be watched through the `IteratorAge` the Pipes documentation mentions, but the metric's name and place were not confirmed in this chapter. Building alarms is in [chapter 19](/en/chapters/19-observability.md)
- **Decide the archive's retention and write it down.** Seven days was chosen for practice. Make it longer than the days it takes to notice and fix a failure, and shorter than the markers' life. What is kept is users' data too, so set it against your promises to delete ([chapter 22](/en/chapters/22-recovery.md))
- **Consider the new Custom Event Bus.** Where your tooling supports it, a bus with retention, order, and starting positions is in some cases easier to handle than this chapter's archive and replay
- **Narrow the trust policy of the pipe's role.** Add the `aws:SourceArn` and `aws:SourceAccount` conditions once you have seen them work on AWS
- **Find out whether the topic policy can take a condition.** As it stands, anyone's rule can publish as long as it goes through EventBridge
- **Decide whether to encrypt the queues and the topic with a KMS key of your own.** EventBridge, SNS, Pipes, and Lambda then each need permission to use the key
- **Give the Timeline function a concurrency limit.** Or put a queue in front of it, as with the counter
- **Decide where the event schemas live.** Once a receiver is in another repository, importing one file no longer works
- **Make the pipe's batches larger.** With more events, one at a time will not keep up. Before batching, decide what happens when part of a batch fails

## Cleaning up

<!-- section: 25.cleanup -->

```bash
vp run events:empty --yes
vp run events:infra:destroy
```

`events:smoke` deletes the object and the note it made. If images uploaded from the app remain, empty the bucket with `events:empty` before deleting the stack. If you published chapter 07's pages to this stack, the content bucket has to be emptied as well. This chapter provides no task for that.

`events:infra:destroy` deletes the bus, the rules, the archive, the pipe, the topic, the three queues, the three functions, the projections table, and everything up to chapter 08. The events in the archive and the messages left in the dead-letter queue go too. This cannot be undone.

The timeline entries and counts of the owners beginning with `smoke-` that `events:smoke` used stay in the projections table, and go with the table.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files placed there.

::: details Verification notes for this chapter

**Checked locally.** The tests are 7 files and 97 tests. Rule patterns that match and do not (the very objects the stack deploys, evaluated by the local evaluator). The evaluator refusing operators it does not implement. Stream records turned into events, and `id` not depending on the stream record. The contract and its version (a gained field is read, the next version and a missing field are refused). The same delivery run twice, the same change published twice, delivery in reverse, a deletion arriving first. A failing target retried and set aside. A replay from the archive delivered to an idempotent consumer, to one that is not, and to one added afterwards, and the rejections rule not matching a replay. A partly failed batch on the counter's queue. Replay planning and telling dead letters apart. The shape of requests to DynamoDB. Infrastructure assertions (least privilege, resource policies, retention, deletion, the renaming that lets it stand next to chapter 08, the list of resource types). Type checking and synth. `events:demo` was run and gave the output shown on the [local page](/en/chapters/25-events/local.md). Four conditions were also broken on purpose, and 5, 3, 2, and 11 tests failed.

**Not checked yet.** Nothing was run against AWS: none of `events:infra:diff`, `events:infra:deploy`, `events:smoke`, `events:status`, `events:replay`, `events:infra:drift`, `events:empty`, or `events:infra:destroy`. So the following were not confirmed on AWS. That the pipe reads the stream, puts each element of the array the function returns into an event's `detail`, and uses `$.type` as `detail-type`. That the function is handed an array even with a batch of one. That the pipe can be created with a role whose trust policy has no condition. That cdkd can create and delete the archive through Cloud Control API. That the rules' patterns give the same answers in EventBridge as in the local evaluator. That a rule, the pipe, Lambda's on-failure destination, and SNS can send to queues encrypted with SQS-managed keys. That EventBridge can publish under a topic policy with no condition. That the input transformer's output lands in the queue as it is with raw message delivery. The shape of a replayed event, and that the rejections rule lets none through. The shape of the messages that reach the dead-letter queue. Whether the pipe's reads are billed. The numbers under "Costs" are calculated from unit prices and assumptions (100 ms per function run, one shard). The delay from a write to its event, and how many records a second the pipe moves, were not measured. The new Custom Event Bus is not used and was not run.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture, queue, topic, or bus | `examples/25-events/infra/lib/events-stack.ts` | `events:infra:synth` |
| The event as a contract | `examples/25-events/src/contract.ts`, `test/shape.test.ts` | `test:unit` |
| From the stream to an event | `examples/25-events/src/shape.ts`, `src/shape-lambda.ts`, `src/routes.ts`, `test/shape.test.ts`, `test/fixtures.ts` | `test:unit` |
| Rules and event patterns | `examples/25-events/src/routes.ts`, `src/pattern.ts`, `test/pattern.test.ts` | `test:unit` |
| The consumers | `examples/25-events/src/timeline.ts`, `src/counter.ts`, `src/counter-queue.ts`, `src/dynamodb-projections.ts`, `test/bus.test.ts`, `test/queue.test.ts`, `test/adapters.test.ts` | `test:unit` |
| Archive and replay | `examples/25-events/src/local-bus.ts`, `src/replay-plan.ts`, `test/bus.test.ts`, `test/operations.test.ts` | `test:unit`, `events:replay` |
| Running it locally | `examples/25-events/src/local.ts`, `src/local-bus.ts`, `scripts/demo.ts`, `test/harness.ts` | `events:demo`, `test:unit` |
| Reading the stack | `examples/25-events/infra/lib/events-stack.ts`, `infra/bin/app.ts`, `infra/test/events-stack.test.ts`, `src/timeline-lambda.ts`, `src/counter-lambda.ts`, `src/env.ts`, `cdk.json` | `events:infra:synth`, `test:unit` |
| Deploying and checking | `examples/25-events/scripts/smoke.ts` | `events:infra:diff`, `events:infra:deploy`, `events:smoke`, `events:infra:drift` |
| When something did not arrive, and sending it again | `examples/25-events/scripts/status.ts`, `scripts/replay.ts`, `src/dead-letter.ts`, `src/replay-plan.ts` | `events:status`, `events:replay` |
| Cleaning up | `examples/25-events/scripts/empty-uploads.ts` | `events:empty`, `events:infra:destroy` |
| Costs | `data/pricing/` | `test:unit` |

**How cdkd (0.296.28) handles the types.** With a provider in `src/provisioning/register-providers.ts`: `AWS::Events::EventBus`, `AWS::Events::Rule`, `AWS::Pipes::Pipe`, `AWS::SNS::Topic`, `AWS::SNS::TopicPolicy`, `AWS::SNS::Subscription`, and the types up to chapter 08. Without one, and so through Cloud Control API: `AWS::Events::Archive`. The `AWS::EventsV2` types have no provider and were not in the list of types Cloud Control API supports.

**Primary sources** (all checked on 2026-10-13)

- [What Is Amazon EventBridge?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html), [Amazon EventBridge event bus (default and Classic)](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html), [Amazon EventBridge quotas](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-quota.html), [Troubleshooting Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-troubleshooting.html)
- [What is the EventBridge Custom Event Bus?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-what-is.html), [Creating Custom Event Bus resources with CloudFormation](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-cloudformation.html), [Ordering and deduplicating events on a Custom Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-ordering.html), [Migrating from Custom Event Bus - Classic to the Custom Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-migrate.html)
- [Amazon EventBridge event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html), [Creating Amazon EventBridge event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-pattern.html), [Comparison operators for use in event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-pattern-operators.html)
- [How EventBridge retries delivering events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html), [Using dead-letter queues to process undelivered events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html), [Amazon EventBridge input transformation](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-transform-target-input.html), [Using resource-based policies for Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-use-resource-based.html)
- [Archiving and replaying events in Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html), [Creating replays of archived events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-replay-archived-event.html), [StartReplay](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_StartReplay.html), [AWS::Events::Archive](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-events-archive.html)
- [Sending events with PutEvents](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-putevents.html), [PutEventsRequestEntry](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutEventsRequestEntry.html)
- [Amazon EventBridge Pipes](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes.html), [Amazon DynamoDB stream as a source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-dynamodb.html), [Event filtering in Amazon EventBridge Pipes](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-filtering.html), [Event enrichment in Amazon EventBridge Pipes](https://docs.aws.amazon.com/eventbridge/latest/userguide/pipes-enrichment.html), [Amazon EventBridge Pipes targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-target.html), [Pipes batching and concurrency](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-batching-concurrency.html), [Pipes error handling and troubleshooting](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-error-troubleshooting.html), [Pipes permissions](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-permissions.html), [AWS::Pipes::Pipe PipeSourceDynamoDBStreamParameters](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-pipes-pipe-pipesourcedynamodbstreamparameters.html)
- [Invoking Lambda with events from other AWS services](https://docs.aws.amazon.com/lambda/latest/dg/lambda-services.html), [How Lambda handles errors and retries with asynchronous invocation](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html), [Capturing records of Lambda asynchronous invocations](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-retain-records.html)
- [What is Amazon SNS?](https://docs.aws.amazon.com/sns/latest/dg/welcome.html), [Amazon SNS message filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html), [Amazon SNS raw message delivery](https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html), [Amazon SNS message delivery retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html), [Message archiving and replay for FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-archiving-replay.html), [Amazon SNS endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/sns.html), [Amazon SNS FAQs](https://aws.amazon.com/sns/faqs/)
- [Change data capture for DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html), [Using IAM with DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html), [TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html), [DynamoDB Time to Live](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/howitworks-ttl.html), [Service Authorization Reference data (DynamoDB)](https://servicereference.us-east-1.amazonaws.com/v1/dynamodb/dynamodb.json)
- [Amazon EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/), [Amazon DynamoDB pricing for on-demand capacity](https://aws.amazon.com/dynamodb/pricing/on-demand/), [Amazon SNS pricing](https://aws.amazon.com/sns/pricing/), AWS Price List bulk API: [EventBridge](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSEvents/current/ap-northeast-1/index.json), [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json), [SNS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSNS/current/ap-northeast-1/index.json)
- Cloudflare: [Queues: How Queues Works](https://developers.cloudflare.com/queues/reference/how-queues-works/), [Queues: Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [Queues: Event subscriptions](https://developers.cloudflare.com/queues/event-subscriptions/), [Queues: Events & schemas](https://developers.cloudflare.com/queues/event-subscriptions/events-schemas/), [Queues: Limits](https://developers.cloudflare.com/queues/platform/limits/), [Queues: Pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- Vercel: [Vercel Queues](https://vercel.com/docs/queues), [Vercel Queues: Concepts](https://vercel.com/docs/queues/concepts)
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts), [Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)

:::
