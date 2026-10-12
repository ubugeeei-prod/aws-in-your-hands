---
title: "38 Data Movement: Run It Locally"
---

# 38 Data Movement: Run It Locally

## Running it locally

<!-- section: 38.local -->

The commands on this page run without an AWS account. They do not call DataSync. What runs is the model of the plan and of an execution from [the previous page](/en/chapters/38-data-movement/build.md), the decision about an event, and the checks on the stacks' templates.

```bash
vp test run examples/38-data-movement
vp run move:demo
vp run move:infra:synth
```

The first line runs the tests. The second runs the task four times against two buckets in memory. This is its output.

```text
1. Four attachments, an empty archive. The execution stops after two copies.
  plan: transfer 4 (32 bytes), skip 0, delete 0
    new     u/alice/n1/a1
    new     u/alice/n1/a2
    new     u/alice/n1/a3
    new     u/alice/n1/a4
  run:  INTERRUPTED, copied 2, archive now holds 2

2. The next execution picks up where the first one stopped.
  plan: transfer 2 (16 bytes), skip 2, delete 0
    new     u/alice/n1/a3
    new     u/alice/n1/a4
  run:  SUCCESS, copied 2, archive now holds 4

3. One object replaced and one deleted in the source, one edited in the archive.
  plan: transfer 2 (26 bytes), skip 1, delete 0
    changed u/alice/n1/a1
    changed u/alice/n1/a2  <- the archive's copy is newer
  run:  SUCCESS, copied 2, archive now holds 4

4. Nothing has changed since.
  plan: transfer 0 (0 bytes), skip 3, delete 0
  run:  SUCCESS, copied 0, archive now holds 4

The archive still holds u/alice/n1/a4: the task keeps what the source deleted.
```

The first execution is stopped after two copies. The second plan lists only the two that are left. For the third, one object was replaced and one deleted in the source, and one was rewritten directly in the archive. The replaced `a1` is copied, and `a2`, rewritten in the archive, is overwritten with the source's contents. The deleted `a4` stays in the archive. The fourth has nothing to do.

`INTERRUPTED` is a name this model gave. DataSync's task execution statuses have no such name.

The third line writes the templates of both stacks into `examples/38-data-movement/cdk.out/`. It asks AWS nothing. To see the template with the task, the rule, and the function in it, pass a value shaped like a location ARN.

```bash
vp run move:infra:synth -c sourceLocation=arn:aws:datasync:ap-northeast-1:111122223333:location/loc-0b3017fc4ba4a2d8d
```

A value that is not shaped like an ARN is refused at synth.

### What is not reproduced locally

A great deal is not. What DataSync judges to be a "difference", how long an execution takes, how fast it transfers, how many requests reach S3, what verification really decides, what the logs contain, and the real event that reaches EventBridge: none of these can be learned from this page's commands. The model tells you what follows from combining the meanings of the settings as the documentation states them, and no more.

The invariant the tests pin is this one sentence. **Every object in the archive is, byte for byte, contents that the source held at some moment, and once one execution succeeds while the source is quiet, nothing is left to copy.** The tests try to break that sentence by rewriting the source in the middle of an execution, stopping an execution part-way, and writing to the archive directly.

There is one case in which it breaks. An object written directly to the archive is not contents the source ever held. Until the next execution overwrites it, the first half of the invariant does not hold. The rule that only the DataSync role may write to the archive is kept by permissions, not by code.
