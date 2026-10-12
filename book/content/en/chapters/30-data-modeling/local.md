---
title: "30 Data Modeling: Run It Locally"
---

# 30 Data Modeling: Run It Locally

Here you run the code from [Design and Build](/en/chapters/30-data-modeling/build.md) and [Build, Continued](/en/chapters/30-data-modeling/more.md) on your own machine. This chapter has no development server. What runs is a script that goes through every access pattern in turn, and the tests.

## Run it locally

<!-- section: 30.local -->

```bash
vp run modeling:demo
```

`modeling:demo` runs a create, an attach, a read, edits, lists, and counts, once each, against the in-memory model. It uses no AWS, no emulator, and no files. For each operation it prints the requests sent, the number of writes, and the result.

<<< @/examples/30-data-modeling/scripts/demo.ts{step}

```text
create a note with two tags and a slug
  sent    TransactWriteItems of 5
  writes  table 10, index 1
  result  created

attach an image
  sent    TransactWriteItems of 2
  writes  table 4, index 0
  result  created

read the note with its attachments
  sent    Query table between NOTE#kyoto and NOTE#kyoto#~
  writes  table 0, index 0
  result  kyoto, 1 attachment

edit the body
  sent    GetItem NOTE#kyoto, update NOTE#kyoto
  writes  table 1, index 2
  result  updated

rename it
  sent    GetItem NOTE#kyoto, TransactWriteItems of 3
  writes  table 6, index 2
  result  updated

list by tag
  sent    Query table begins_with TAG#food#NOTE#
  writes  table 0, index 0
  result  ramen | Kyoto in autumn

list the most recently updated
  sent    Query gsi1 begins_with UPDATED#
  writes  table 0, index 0
  result  Kyoto in autumn | ramen

the same list, with the index held back and one more note created
  sent    Query gsi1 begins_with UPDATED#
  writes  table 0, index 0
  result  Kyoto in autumn | ramen   (no diary yet)

count the notes
  sent    GetItem QUOTA
  writes  table 0, index 0
  result  3

count a tag before the stream consumer has run
  sent    GetItem TAGCOUNT#food
  writes  table 0, index 0
  result  0

feed the stream consumer 15 records, then the same 15 again
  sent    TransactWriteItems of 2, TransactWriteItems of 2, TransactWriteItems of 2, TransactWriteItems of 2, TransactWriteItems of 2, TransactWriteItems of 2
  writes  table 24, index 0
  result  first 3 applied, second 0 applied and 3 recognized

count the tag again
  sent    GetItem TAGCOUNT#food
  writes  table 0, index 0
  result  2
```

The `writes` line counts item writes. An item inside a transaction is counted as two. While every item is 1 KB or less, that number equals the write request units; a larger item adds one for each further kilobyte. A `ConditionCheck`, which only tests a condition, is counted as two as well, but whether DynamoDB bills it as a write or as a read was not confirmed.

Three things to read from the output.

Editing the body (`edit the body`) is one write to the table and two to the index. Changing the title (`rename it`) rewrites the items of both tags, so it becomes a transaction.

A note created while the index is held back (`the same list, with the index held back`) is not in the list. It is in the table.

Handing the stream records to the function twice leaves the count for `food` at 2: the second time, all three are recognized as duplicates. Of the 15 records only the three for tag items move a count, and the rest are ignored. The second run still sends its transactions in order to recognize the duplicates, so its writes are billed.

### What the in-memory model reproduces

`MemoryTable`, which the tests and this script use, is not a stand-in for DynamoDB. It is a model of exactly the rules this chapter relies on.

It models conditional writes, transactions (all or nothing, at most 100 items, no item named twice), sort key ranges and order, paging, a sparse index with a projection, the number of index writes, and a stream with one record per change.

<<< @/examples/30-data-modeling/src/memory-table.ts{transact}

Two things exist in the model and not in the real service: `pauseIndex`, which stops the index from following, and `conflictOnce`, which makes the next transaction fail as a collision. They are there so that situations you cannot schedule on the real thing happen in a fixed order inside a test.

It does not model capacity and throttling, the 1 MB page limit, partitions, latency, IAM, or the item size limit. String comparison differs too: DynamoDB compares UTF-8 bytes, and the model compares JavaScript strings. This chapter's keys are ASCII only, so the order is the same.

### Run it on DynamoDB Local

The same code can be pointed at chapter 05's DynamoDB Local. Copy `examples/30-data-modeling/.env.example` to `.env`.

<<< @/examples/30-data-modeling/.env.example

```bash
vp run db:local:start
vp run modeling:db:migrate:local
```

`db:local:start` is chapter 05's task and needs a Docker daemon, which the devShell does not include. `modeling:db:migrate:local` creates this chapter's table, under another name, in the same emulator as chapter 05's.

<<< @/examples/30-data-modeling/scripts/local-db.ts{create-table}

`AttributeDefinitions` lists only the four attributes used as keys of the table and the index. No other attribute is declared anywhere. This definition and the one in the CDK stack are kept in step by hand.

## Tests

<!-- section: 30.tests -->

```bash
vp run test:unit
vp run modeling:test:local
```

| Layer | Files | What it sees | What it cannot see |
| --- | --- | --- | --- |
| Keys and plans | `test/keys.test.ts`, `test/plan.test.ts`, `test/page-token.test.ts` | Neighbouring notes stay out of a range, time order, the separator refused, what a transaction contains and its bound, token validation | How DynamoDB behaves |
| Table rules | `test/table-contract.ts` | Conditions, transactions, range queries, paging, the index. Run against both the in-memory model and DynamoDB Local | The real service's distributed behaviour |
| Notebook rules | `test/notebook-contract.ts` | The six reads and the rules for writes. Run against both as well | The same |
| What only the model shows | `test/memory-table.test.ts`, `test/notebook.test.ts` | Index lag, the number of index writes, colliding transactions and their retries, a delete that stops half way | When and how often the real thing does it |
| Requests | `test/dynamodb-table.test.ts` | The expressions, keys, and consistency sent to DynamoDB, and how cancellation reasons are mapped | That DynamoDB acts on the request as written |
| Stream | `test/projector.test.ts`, `test/stream-lambda.test.ts` | A batch delivered twice, the function's own writes, a failure part of the way and the resume, the shape of a record | How Lambda actually delivers |
| Migration | `test/migration.test.ts` | Neighbouring phases reading each other, reruns, resuming, interleaving with the application's writes | Time and cost on a real table |
| Infrastructure | `infra/test/modeling-stack.test.ts` | Keys and projection, limits, permissions, the filter, the retry count, the removal policy | That AWS acts on the template as written |

The table rules and the notebook rules are written once and run against both the in-memory model and DynamoDB Local. Where the model behaves differently from DynamoDB, the DynamoDB Local run fails. The model can be trusted exactly as far as those two suites pass.

`modeling:test:local` fails when `DYNAMODB_ENDPOINT` is missing. The test file itself skips when there is nothing to connect to, which is the `1 skipped` in the output of `vp run test:unit`.

Against DynamoDB Local (3.3.1), the 16 table rules and the 19 notebook rules passed. That run did not use Docker: the jar AWS distributes was started directly with Java. What DynamoDB Local confirmed is that the expressions are accepted, and that conditions, transactions, ranges, and the index give the same results on one node as the model does.

Some things DynamoDB Local cannot confirm. According to the documentation it does not report transaction conflicts (`TransactionConflict`), so the path that collides and retries was exercised only through the model's `conflictOnce`. Nor does an emulator say how far an index lags. The stream function and the migration were not run on DynamoDB Local.

So the three things at the centre of this chapter, that transactions sort out simultaneous writes correctly, that the index catches up afterwards, and that the stream function recognizes duplicates, have never been checked on real DynamoDB and Lambda. What was checked is that the right requests are sent, and that the code does what is intended on a model that copies the documented rules.
