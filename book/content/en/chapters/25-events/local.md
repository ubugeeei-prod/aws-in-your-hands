---
title: "25 Events: Run It Locally"
---

# 25 Events: Run It Locally

## Running it locally

<!-- section: 25.local -->

This page runs the consumers read on the [previous page](/en/chapters/25-events/build.md) without AWS. In place of EventBridge there is a small bus in memory with rules, retries, a place for what could not be delivered, an archive, and replay, and it carries the same patterns as the stack.

This chapter has no development server. The API is chapter 08's, unchanged, and a local API has no stream to make events from. A script that feeds stream records in order takes its place.

```bash
vp run events:demo
```

The output below is from a local run on 2026-10-13.

```text
two notes created, one updated, each once    counter=2  naive=2  n1=NoteUpdated  dead letters=0
the creation of n2 published a second time   counter=2  naive=3  n1=NoteUpdated  dead letters=0
n2 deleted, delivered twice, in reverse      counter=1  naive=1  n1=NoteUpdated  dead letters=0
replay of 6 archived events                  counter=1  naive=3  n1=NoteUpdated  dead letters=0
rejection notices sent: 1, for one rejected attachment
One note exists (n1). The counter that remembers event IDs says 1.
```

`counter` is the implementation that remembers each event's `id`, and `naive` is the one that adds whenever something arrives. On the first line both say 2, correctly. On the second, the same creation is put on the bus twice and only `naive` becomes 3. The third line delivers the deletion twice to each consumer, in reverse order. `naive` is back at 1 and looks right, but only because one addition too many and one subtraction too many cancelled out. On the fourth line the replay takes `naive` to 3. One note exists.

No Docker and no AWS credentials are needed.

### In place of the bus

<<< @/examples/25-events/src/local-bus.ts{types}

<<< @/examples/25-events/src/local-bus.ts{rules}

Adding a rule runs its pattern through the evaluator. A pattern that uses an operator the evaluator does not implement is refused here.

<<< @/examples/25-events/src/local-bus.ts{put}

On receiving an event the bus gives it an `id` and a time of its own, keeps it if it matches the archive's pattern, and lines up one delivery for each rule it matches. Nothing is delivered at this point.

<<< @/examples/25-events/src/local-bus.ts{deliver}

Delivering is the caller's job. `take` hands over the waiting deliveries, and the caller passes them to `deliver` in any order it likes. Passing the same delivery twice is a duplicate. A delivery whose target threw lines up again with its attempt count raised by one, and at the limit it is set aside along with the reason.

<<< @/examples/25-events/src/local-bus.ts{replay}

A replay picks from the archive the events whose time falls in the span, adds `replay-name`, and checks them against the rules again. It does not archive them again.

<<< @/examples/25-events/src/local.ts{local}

The consumers are the same functions that run on Lambda. What differs is that their stores are in memory and that what stands in front of them is not EventBridge.

This bus does not simulate EventBridge. Here is what it does not reproduce.

- EventBridge's delivery itself. Duplicates and reordering are caused by the tests on purpose and never happen by themselves
- The evaluation of event patterns. The local evaluator has some of the operators only, and compares numbers differently from EventBridge
- The spacing of retries, and the way the kind of error changes the handling. EventBridge sets aside an error such as a missing permission without retrying
- The input transformer. The template's text is checked by the stack's tests, but nothing EventBridge filled in was looked at
- Pipes: evaluating the filter, how the function is handed records, order per shard, retries
- SNS: delivery from the topic onwards, and its retries
- The pace of a replay and its one-minute slices. Locally, the chosen events all line up at once
- IAM: every resource policy and every role

### Tests

```bash
vp run test:unit
```

The tests assemble the same parts with the clock and the IDs fixed. The stream records are not JSON written by hand: functions in `test/fixtures.ts` build them from the types of chapter 05's note and chapter 08's inspection record. Their shape comes from the example in the Pipes documentation and not from a real stream.
