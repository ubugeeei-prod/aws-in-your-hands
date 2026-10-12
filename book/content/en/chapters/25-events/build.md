---
title: "25 Events: Design and Build"
---

# 25 Events: Design and Build

The [first page](/en/chapters/25-events.md) showed the setup: changes to the table become events on a bus, and three consumers receive them. This page reads the code in order: the shape of an event, the part that makes events from the stream, the rules' patterns, the consumers, and replay. All the code on this page can be tested without calling AWS.

## The event as a contract

<!-- section: 25.contract -->

An event is an agreement between a sender and receivers that are deployed separately. Unlike an API request, the sender does not know how many receivers there are, so it cannot see who is hurt when the shape changes. The shape is therefore written once, as a schema, and both sides check against the same schema.

<<< @/examples/25-events/src/contract.ts{envelope}

Every event carries five fields. Two of them, `id` and `version`, have a job.

`id` names the thing that happened, not the delivery. Chapter 08 explained why an SQS message ID cannot serve as an idempotency key. EventBridge gives an event an `id` too, and that is also the name of a delivery: the same change put on the bus twice has two EventBridge `id`s. This chapter's `id` is made from the note's ID and version, so the same change has the same value however often it is sent.

`version` is the version of the shape of `detail`. For now there is only 1.

Leaving the title and the body out of the event is deliberate. An event stays in the archive for 7 days and in the dead-letter queue for 14. The body of a note should not remain there after its owner deleted the note, so an event carries IDs, versions, and times only. A consumer that needs the content reads it by ID.

<<< @/examples/25-events/src/contract.ts{events}

There are four events. The three about notes are joined with `v.variant`, which picks the shape by `type`. The inspection event has one more check: a rejected one has a reason. The input transformer that comes later writes the reason into a message, so a rejection without one cannot be let through.

### How the version moves

The schemas are written with `v.object`, not `v.strictObject`. `v.object` drops fields it does not know without complaint. When the sender adds a field, a receiver keeps reading with today's code.

Two rules follow.

- Adding a field leaves `version` as it is. Receivers ignore fields they do not know
- Removing a field, renaming one, or changing what one means raises `version`. During the move the sender sends both the old and the new version

The rules' patterns contain `version: [1]`, so a version 2 event does not reach a consumer written for version 1. If it did, the schema says `v.literal(1)`, and the consumer fails instead of misreading. The tests check that an event with an extra field is read, and that the next version and an event with a field missing are refused.

EventBridge also has a schema registry to keep schemas in. This chapter does not use it: the place receivers get the schema from was meant to be one file in the repository. Once teams or repositories part, the schema needs a home decided for it.

<<< @/examples/25-events/src/contract.ts{bus-event}

A target receives `detail` wrapped in EventBridge's own fields. `replay-name` is there only on a replayed event.

## From the stream to an event

<!-- section: 25.pipe -->

```figure
caption: One write passes through the stream, the pipe, and the function, and becomes one event
type: sequence
actor table: Notes | table
actor pipe: Changes | pipe
actor shape: Shape | function
actor bus: aih-events | bus
note table: UpdateItem: version 2
note table: MODIFY in the stream
step pipe -> table: GetRecords
note pipe: passes the filter
step pipe -> shape: [record]
step shape -> pipe: [NoteUpdated]
step pipe -> bus: PutEvents
```

The pipe polls the stream four times a second. A record it finds goes through the filter first.

<<< @/examples/25-events/src/routes.ts{pipe-filter}

A filter is written the same way as the event patterns of the rules below. It lets through only records of items whose sort key begins with `NOTE#` or `INSPECTION#`. The same table also holds attachment records (`ATTACHMENT#`) and chapter 05's item for the note quota (`QUOTA`). Changes to those are dropped here. Pipes charges only for what passes the filter, so dropping what is not wanted before the function sees it also saves the function's runs.

Some fields cannot be used in a filter. According to the documentation, `eventName` (INSERT, MODIFY, REMOVE) and `eventID` are added by the pipe as it polls, and a pattern cannot name them. Telling the kinds of change apart is left to the function that follows.

<<< @/examples/25-events/src/shape.ts{record}

A stream record arrives in DynamoDB's notation, each value wrapped in the name of its type. It comes from outside the types too, so it is checked against a schema and then turned into a plain object. Only the four types this table's notes and inspection records use are read. Any other type is a failure.

<<< @/examples/25-events/src/shape.ts{shape}

This function turns one record into one event, or into nothing. Three things in it are worth a look.

The first is how `id` is made. A stream record has an `eventID` of its own, and it is not used. Made from the note's ID and version, the `id` is the same when the pipe reads a record twice, and the same if the change is ever sent again by some other route. The inspection event takes for its `id` the pair chapter 08 used as its idempotency key: the object's key and its `sequencer`.

The second is when it returns nothing. A rewrite that did not change the version, and the removal of an inspection record, are of no interest to any consumer, so they become no event.

The third is that it throws on a record it cannot read. An item under `NOTE#` that does not read as a note, if skipped quietly, is a change nobody will ever know happened.

<<< @/examples/25-events/src/shape.ts{enrich}

<<< @/examples/25-events/src/shape-lambda.ts{handler}

In Pipes' terms this function is the enrichment. The pipe calls it synchronously and sends each element of the array it returns to the target. An empty array sends nothing. With an event bus as the target, a returned element becomes the event's `detail` as it is, and `detail-type` is taken from the element's `type`, through the `$.type` written in the pipe's settings.

### When the pipe stops

When the function throws, the pipe hands it the same record again. How many times is "without limit" by default, until the record leaves the stream 24 hours later. Meanwhile the records behind it in the same shard wait. One unreadable item stops the events of every other note for a day.

The pipe in this chapter retries three times, and a record that still fails is set aside in the dead-letter queue. It also hands over one record at a time. Handed over in a batch, one failure would send the other records of the batch round again. The documentation describes a way to fail part of a batch, and says it is not supported for the enrichment step. One record at a time means one record in flight per shard, so a great many changes cannot be moved quickly. That was judged acceptable for a notes app, and where it starts to back up was not measured.

What the pipe promises is delivery at least once, like everything else here. The same record can reach the function twice, and the same event can be put on the bus twice. EventBridge's `id` is then two values, and `detail.id` is one.

## Rules and event patterns

<!-- section: 25.rules -->

<<< @/examples/25-events/src/routes.ts{rules}

An event pattern is JSON in the shape of the event. Every field it names has to match. The array for a field means "any of these", and fields it does not name are not looked at.

The three rules, one by one. timeline takes every event whose `detail-type` begins with `Note`. counter takes only creations and deletions, the ones that move the count. rejections takes inspection events whose `verdict` is `rejected` and which have no `replay-name`, that is, which are not replays. The reason for that last condition is in the section on replay.

Every pattern names `source`. One day another application may put events on this bus. A rule that went by `detail-type` alone would take someone else's `NoteCreated` as well.

Both the stack and the tests import this object. The patterns that are deployed and the patterns that were checked locally cannot drift apart.

### Evaluating a pattern locally

To see whether a pattern matches what it should without deploying, the example has a small evaluator.

<<< @/examples/25-events/src/pattern.ts{compile}

It implements four things and no more.

- Matching a value: a string, a number, a boolean, or `null`, any one of those listed
- `prefix` and `suffix`
- `exists`
- `numeric`, with one comparison or two

`$or`, `anything-but`, `equals-ignore-case`, `wildcard`, `cidr`, and combinations such as `equals-ignore-case` inside `prefix` are not implemented. Using one throws `UnsupportedPatternError` at the moment the rule is added. Stopping was preferred to answering "probably no match" by guesswork.

Three places are known where its answer can differ from EventBridge's. It compares numbers as values after `JSON.parse`, while EventBridge compares them as written, so that `300` and `300.0` are different values there. For `exists`, the documentation says it works on leaf nodes only, so a field holding an object is treated as absent, and what EventBridge answers there was not checked. Arrays inside an event are not handled: when a pattern looks at such a field, the evaluator throws.

This evaluator is not EventBridge's implementation. What it can confirm is the intent of a pattern you wrote. The real answer comes from `aws events test-event-pattern`, which was not run for this chapter.

The tests pin a match and a non-match for each rule.

| Event | timeline | counter | rejections |
| --- | --- | --- | --- |
| NoteCreated | match | match | no match |
| NoteUpdated | match | no match | no match |
| NoteDeleted | match | match | no match |
| AttachmentInspected, ok | no match | no match | no match |
| AttachmentInspected, rejected | no match | no match | match |
| The same rejection, replayed | no match | no match | no match |
| NoteCreated from another `source` | no match | no match | no match |
| NoteCreated with `version` 2 | no match | no match | no match |

## The consumers

<!-- section: 25.consumers -->

What has to hold, in one sentence first.

**However many times the same change arrives, and in whatever order, the timeline and the count are what they would be had each change arrived once.**

Here is what the parts on the way promise. The pipe delivers at least once. EventBridge's documentation says that in rare cases the same rule runs more than once for a single event. Lambda's documentation says that with asynchronous invocation a function can receive the same event several times even when it returned no error. And a replay delivers the same events again. "Exactly once" is nowhere.

### Compare, then write: the timeline

<<< @/examples/25-events/src/timeline.ts{timeline}

The timeline keeps one row per note: the latest thing that happened to it. The idea is that of chapter 08's inspection record. A value that stands for order (`rank`) is stored with the row, and a write happens only when it is newer than what is there. `rank` is the note's version, and a deletion comes after every version.

<<< @/examples/25-events/src/dynamodb-projections.ts{timeline-store}

The same event again has an equal `rank` and is refused. An older event arriving late has a smaller `rank` and is refused. One condition covers duplicates and reordering alike. When what is stored is "the latest state", this is the simplest way.

### Remember, then add: the counter

A count cannot be kept the same way. "Add one" done twice adds two, and there is nothing to compare an order against.

<<< @/examples/25-events/src/counter.ts{counter}

`createNaiveCounter` adds whenever something arrives. It is correct if every event arrives exactly once. This chapter does not deploy it. It runs in the tests beside `createCounter`, to show where the numbers part.

`createCounter` remembers the `id` of each event it added. What matters is that remembering and adding are one step.

<<< @/examples/25-events/src/dynamodb-projections.ts{counter-store}

A DynamoDB transaction holds two writes. One is the marker that says "this event was counted", and it can be written only while it is absent. The other adds to the count. Both happen or neither does. Chapter 08 could not use a transaction, because an S3 operation followed its marker. Here both writes go to the same table, so it can.

If the marker is already there, DynamoDB cancels the transaction and reports that the first write's condition failed. That is not a failure but an answer, "counted before", and it is returned as success. A cancellation for any other reason, such as a conflict with another transaction, is thrown as the failure it is.

Markers pile up, so each has an expiry. With the table's TTL setting, DynamoDB deletes markers past it. How long they live is bound by a condition.

<<< @/examples/25-events/src/routes.ts{retention}

If the archive holds 7 days of events, an event from 7 days ago can come back in a replay. If its marker were gone by then, it would be counted again. A marker has to outlive every event a replay can bring back. A test on the stack checks that the one number is greater than the other.

### A queue in front: the counter's entrance

<<< @/examples/25-events/src/counter-queue.ts{batch}

The counter is not invoked by its rule directly. A queue stands in between. It is built like chapter 08's worker and returns only the IDs of the messages that failed. "Counted before" is success, so replayed events do not pile up in the dead-letter queue.

A function invoked directly, like the timeline, and one behind a queue, like the counter, take different roads when they fail.

| | Directly from a rule (timeline) | Behind a queue (counter) |
| --- | --- | --- |
| How it is called | Asynchronous invocation, one event at a time | An event source mapping, up to 10 messages |
| When the function fails | Lambda retries twice, then sends it to the on-failure destination | The message returns to the queue, and moves to the DLQ after 5 receives |
| How many run at once | Up to the function's concurrency | The event source mapping's limit (2 in this chapter) |
| Where the backlog can be seen | Nowhere: a queue inside Lambda you cannot look into | The SQS queue |
| Parts added | None | One queue, and the requests that poll it while it is empty |

Calling directly takes fewer parts. A queue in between separates the speed things arrive at from the speed they are handled at, and shows how much is waiting. If something downstream needs a ceiling on concurrency, a database or an outside API, that is a reason for the queue.

### Tests that fix the order and break it

The tests attach three rules and three consumers to an in-memory bus, and run the counter that remembers nothing on a fourth rule. The test decides the order and the number of deliveries.

| What is injected | timeline | counter | counter that remembers nothing |
| --- | --- | --- | --- |
| The same delivery twice | unchanged | 1 | 2 |
| The same change put on the bus twice (two bus `id`s) | unchanged | 1 | 2 |
| A creation and two updates, delivered in reverse | the last update | not involved | not involved |
| A deletion delivered before the creation | stays deleted | 0 | 0 |

The last row shows the same value in the two right-hand columns because adding and subtracting do not depend on order. With reordering alone, even the implementation that remembers nothing gets the count right. It goes wrong when the same thing arrives twice.

The tests also check that a target that fails twice and succeeds the third time receives the event once, that an event no consumer can read is set aside after three attempts, and that one consumer failing every time does not keep the event from the others.

Four places in the code were also broken on purpose to see tests fail. With the counter not looking at its marker, 5 fail. With the timeline not comparing `rank`, 3. With an update's `id` taken from the stream's `eventID`, 2. With a pattern's "any of" turned into "all of", 11.

## Archive and replay

<!-- section: 25.replay -->

An archive keeps the events that reach the bus and match a pattern, for a number of days you set. A replay sends the events of a chosen span of time from the archive to the same bus again. Name rules, and it goes to those rules only.

It has two uses. One is sending again what a consumer missed, after the consumer's bug is fixed. The other is letting a consumer added later read past events.

The properties the documentation states are these.

- A replayed event carries a field named `replay-name`. That field is the only difference the documentation mentions
- Events do not come in the order they were archived. The span is cut into minutes by event time, and the earliest minute goes first
- An event takes a while to reach the archive. For recent events the advice is to wait 10 minutes before replaying
- A replayed event is not archived a second time
- A replay removes nothing from the archive. The same span can be sent as often as you like

Seen from a receiver, a replay is a large number of duplicates arriving in no particular order. The consumers of the previous section are built for that.

| Replayed to | Result |
| --- | --- |
| timeline | Nothing changes, whatever the order |
| counter | Nothing changes: every event was "counted before" |
| counter that remembers nothing | A count of 1 becomes 2: two creations and one deletion are added again |
| a timeline added afterwards | Ends with the same content as the original |
| rejections | Not one event arrives: the rule lets no replay through |

The third row is what happens when a replay reaches a consumer that is not idempotent. No error appears. The number is quietly wrong. Run a replay after making sure every consumer is idempotent, or name only the rules of consumers that are.

### A consumer that cannot take it back

The notice of a failed inspection cannot be made idempotent. Once SNS has sent an email, nothing in this setup keeps the same email from being sent again.

So the rejections rule requires that `replay-name` be absent. A replayed event does not match it. EventBridge itself uses the same condition to keep replayed events out of an archive.

The choice gives something up. If the notice path was down for half a day, the events of that time cannot be sent again by a replay. They have to be sent again from what is left in the dead-letter queue. Having a person look at the notices of the outage and send them was preferred to sending the same notice twice. For other notices the opposite choice is the right one.

That the rejections rule keeps replays out on AWS was not confirmed. The steps to confirm it are on the [deploy page](/en/chapters/25-events/deploy.md).
