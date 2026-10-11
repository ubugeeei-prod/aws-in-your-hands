---
title: "05 Persist Notes: DynamoDB"
sourceRevision: 2
---

# 05 Persist Notes: DynamoDB

The chapter 04 API kept its notes in memory. A different execution environment gave a different answer, and after a while the notes were gone. In this chapter, let's save them properly.

The notes go into a DynamoDB table, so a read from any execution environment returns the same answer. Along the way you'll deal with the things you can't avoid once you save data. Two people editing the same note at the same time, without the later save silently overwriting the earlier one. A save that is retried because its response never arrived, and is not applied twice. A list that pages through without dropping notes as their number grows. And the function gets permission for five operations on this one table, nothing more.

This chapter builds on [chapter 04](/en/chapters/04-http-api.md). The code is in `examples/05-dynamodb/`. It carries over the chapter 04 API and extends it, and it runs on its own.

There's still no authentication. Anyone who knows the URL can read and write (authentication is [chapter 06](/en/chapters/06-auth.md)). Please don't put in data you'd mind other people seeing.

If your data is something you want to query with SQL, you can skip this chapter and go on to chapter 13 (planned). The section "When DynamoDB doesn't fit", later on, gives some guidance for deciding.

## The big picture

<!-- section: 05.architecture -->

```text
Client
  |  HTTPS
  v
API Gateway HTTP API
  |  routes: GET /health, GET|POST /notes, GET|PUT|DELETE /notes/{id}
  v
Lambda function (any number of execution environments; they hold no notes)
  |  execution role: GetItem, PutItem, UpdateItem, DeleteItem, Query on one table
  |  AWS SDK for JavaScript v3
  v
DynamoDB table (ap-northeast-1, on-demand)
  pk = OWNER#<owner>    sk = NOTE#<note id>    version, title, body, ...
```

What changed from chapter 04 is the bottom layer. The owner of the state used to be each individual execution environment; now it's the table. However many execution environments there are, and whenever one disappears, it no longer hurts.

### Why DynamoDB?

DynamoDB is a database in which you read and write items by specifying a key. There are three reasons for choosing it in this chapter.

- There are no connections to manage. You call an HTTPS API and that's it. When the number of Lambda execution environments grows, you don't have to think about connection limits or pools
- It needs no network design. It doesn't have to sit inside a VPC, so you add one table to the chapter 04 architecture and you're done
- While it isn't being used, the only charge is for what is stored. For an on-demand table, the request charge is 0 when there are no requests

In exchange, you have to **decide first how you will read**. You can't filter freely by a condition you think of later, the way you can in SQL. The second half of the chapter covers the cases where this doesn't fit.

## Derive the keys from how you read

<!-- section: 05.model -->

DynamoDB table design starts from "how do you read and write?", not from "what data is there?". This API reads and writes in two ways.

1. List one owner's notes, newest first
2. Given an owner and a note ID, read, update, or delete that one note

A DynamoDB item is uniquely identified by the pair of its partition key and its sort key. Items with the same partition key are stored together and, within that group, ordered by sort key. Let's map the two access patterns onto this property.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{keys}

With the owner as the partition key, "all of one owner's notes" can be read with a single Query. With the note ID as the sort key, "one note" can be read by an exact match on the key.

That leaves "newest first". The creation time goes at the front of the ID, so that sort key order is creation order.

<<< @/examples/05-dynamodb/src/id.ts{id}

Now listing is only a matter of reading in reverse sort key order, and you need no index for sorting. The order of two notes created in the same millisecond is decided by the random part.

There's no authentication yet, so the owner is a fixed value shared by everyone. Chapter 06 replaces it with the signed-in user, but the shape of the key doesn't change.

<<< @/examples/05-dynamodb/src/notes.ts{service}

## Add a version to the contract

<!-- section: 05.contract -->

<<< @/examples/05-dynamodb/src/contract.ts{note}

A note now has a `version`. It is 1 at creation and increases by exactly 1 each time a save succeeds. When updating, the caller sends "the version I was looking at" as `expectedVersion`.

`expectedVersion` is required. If it could be omitted, an update that doesn't say what it was based on would go through, and you couldn't prevent overwrites.

The error codes gain `conflict`, which returns the note as it is stored now as `current`.

<<< @/examples/05-dynamodb/src/contract.ts{error}

## Swap the storage

<!-- section: 05.repository -->

Because chapter 04 made `NoteRepository` an interface, most of the app doesn't know where notes are stored. In this chapter you revise that interface so that it also expresses the outcomes that can occur.

<<< @/examples/05-dynamodb/src/repository.ts{interface}

"Someone saved first" isn't an exceptional accident. It's an outcome that happens in normal operation. So it isn't thrown as an exception; it's part of the return type. If the caller forgets to handle the `conflict` case, type checking fails.

There are two implementations.

`InMemoryNoteRepository` is for local development and tests. It needs neither Docker nor AWS. In exchange, it reproduces nothing about DynamoDB, and the data is gone when the process restarts.

`DynamoDbNoteRepository` is the real thing, used after deployment. Locally you can also point it at DynamoDB Local.

That the two follow the same rules is checked by running one set of contract tests against both. More on that in the tests section.

Here's where the connection to DynamoDB is assembled.

<<< @/examples/05-dynamodb/src/compose.ts{repository}

On Cloudflare Workers, D1 and KV appear on `env` as bindings. On AWS, you connect three separate things yourself: the table's name (configuration), the SDK client (code), and the permission to use the table (the execution role on AWS, your own credentials locally).

## Prevent overwrites: conditional writes

<!-- section: 05.conditional -->

You open the same note in two tabs, edit it in both, and save from both. What happens?

```text
time  tab A                          tab B                          stored
t1    GET  -> version 1              GET  -> version 1              v1 "draft"
t2    PUT expectedVersion=1 -> 200                                  v2 "from A"
t3                                   PUT expectedVersion=1 -> 409   v2 "from A"
t4                                   shows A's text next to its own
```

If B's save were let through at t3, A's change would disappear without anyone knowing. What prevents this is optimistic locking. Rather than taking a lock in advance, you check at the moment of writing whether the stored version is still the one you were looking at.

Here's the catch. If app code does "read, compare the version, and write if it's the same" as two separate steps, another write can get in between them. The comparison and the write have to happen inside the database as one operation. In DynamoDB, a condition expression is what does that.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{update}

The single line `ConditionExpression: "version = :expected"` is all there is to the optimistic locking. DynamoDB evaluates the condition and performs the update as one operation, so two writes that carry the same version cannot both go through. When the condition doesn't hold, DynamoDB returns `ConditionalCheckFailedException`.

The read that follows is a separate operation. It's there to find out why the condition failed (the note doesn't exist, or the version has moved on) and to hand the current content to the caller. The note can change once more between this read and the original update. So `current` is "the content close to the time the 409 was returned"; it is not necessarily "the content that is still correct now".

Creation uses the same mechanism.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{create}

`PutItem` silently replaces an item that has the same key. With `attribute_not_exists(pk)`, it fails when the key is already in use.

The app returns `conflict` as an HTTP 409.

<<< @/examples/05-dynamodb/src/app.ts{update}

Written as one sentence, the invariant being kept is this.

**Each time a save succeeds, the version increases by exactly 1, and an update based on an old version is rejected.**

## Choose the read consistency

<!-- section: 05.consistency -->

DynamoDB has two kinds of reads.

| | Eventually consistent | Strongly consistent |
| --- | --- | --- |
| Is the write just before it visible? | Sometimes not. It is visible if you wait a little and read again | Every successful write is reflected |
| Price | Half of strongly consistent | 1 read request unit for one item of up to 4 KB |
| Default | This one | Specify `ConsistentRead: true` |

According to the official documentation, a write is durable at the point where it returns a successful response. When an eventually consistent read doesn't see it, that isn't because it was lost. It hasn't yet reached the place the read went to.

This chapter chooses per operation.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{get}

Reading one note is strongly consistent. If you reread the same note right after saving it and get the content from before the save, you'd think "wait, did the save fail?"

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{list}

The list stays eventually consistent. It costs half as much, and a list that is stale for a moment does no harm. In exchange, a note that was created a moment ago can be missing from the next list. When you build the screen (chapter 06), you can keep this gap from the user by adding the note received in the creation response to the list you display.

This choice holds because conditional writes don't depend on read consistency. Even if you send an update after looking at a stale list, the `version` condition is evaluated inside DynamoDB against the latest value. A stale read can cause more 409s, but it cannot cause an overwrite.

By the way, strongly consistent reads are available only on the table itself and on local secondary indexes, not on global secondary indexes. This chapter doesn't use an index.

## Page through without dropping items

<!-- section: 05.pagination -->

A single `Query` returns at most 1 MB of results. Anything beyond that is not returned. And it isn't an error either. On top of that, this API also caps the number of items per page with `Limit`. Whichever of the two stops a query early, the signal DynamoDB gives is the same. If you return the list on the assumption that you got everything, then one day, after the notes have grown, older notes silently stop being shown. Not a fun bug.

When there may be more, DynamoDB adds `LastEvaluatedKey` to the response. Pass it as `ExclusiveStartKey` to the next `Query` and you continue from where the last one stopped. This API hands it to the caller as a cursor.

<<< @/examples/05-dynamodb/src/contract.ts{list}

<<< @/examples/05-dynamodb/src/app.ts{list}

The cursor goes out to the caller and comes back. By the time it comes back, it's an untrusted value like any other input. It isn't passed to DynamoDB as it is; it's decoded and its shape is checked.

<<< @/examples/05-dynamodb/src/repository.ts{cursor}

The official documentation warns about this too: the presence of `LastEvaluatedKey` does not mean "there are more items". It is also present when the results end exactly at a page boundary. In that case the next page is empty and the cursor is `null`. So the caller's condition for stopping is "until `nextCursor` is `null`". Getting fewer items than `limit` must not be taken as the signal that the list has ended.

## When the response never arrives

<!-- section: 05.lost-response -->

A write over a network has a third outcome besides success and failure: "unknown".

```text
time  client                               server                 stored
t1    PUT expectedVersion=1  ----------->  applies the update     v2 "final"
t2    (response is lost; timeout)  <--x--  200 OK
t3    was it saved? unknown. retry:
      PUT expectedVersion=1  ----------->  version is 2, not 1    v2 "final"
t4    409 conflict, current = v2 "final"
```

At t2, the caller doesn't know whether the save went through. If it doesn't retry, the change is lost in the case where it wasn't saved. So it retries, and at t4 a 409 comes back. The cause is not someone else's write but **its own first write**.

Optimistic locking does two things here. One is that the retry was not applied twice. The version is still 2; it has not become 3. The other is that the 409 carries `current`, so the caller can work out what happened.

<<< @/examples/05-dynamodb/src/client.ts{outcome}

If the stored note is exactly one version ahead and has the content that was sent, the write you wanted has been done. The typed client returns this case as a success.

<<< @/examples/05-dynamodb/src/client.ts{update}

This decision has a limit. It can't tell this case apart from one where someone else saved exactly the same content at the same version. Even then, the stored content is what you wanted, so treating it as a success does no harm. In the opposite case, where your write went through and someone else saved again before your retry, the client returns a conflict. Your save did happen once, but what is stored now is someone else's content, so showing that is the safe outcome.

Creation, by the way, doesn't have this protection. `POST /notes` has nothing with which to tell a retry from the creation of a new note, so losing a response and retrying produces two notes with the same content. A test records this behavior as the specification. Fixing it requires the caller to send a value that shows "this is the same request" (idempotency, planned for chapter 08).

## Run it on your machine

<!-- section: 05.local -->

Let's run it. Copy `examples/05-dynamodb/.env.example` to a file named `.env` in the same place.

<<< @/examples/05-dynamodb/.env.example

The validation of the environment variables expresses in its schema that the required variables change with where notes are stored.

<<< @/examples/05-dynamodb/src/env.ts{env}

### In memory first

Start it with the default `NOTES_STORE=memory` left as it is. No Docker, no AWS.

```bash
vp run dev:notes
```

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"draft"}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"final","body":"","expectedVersion":1}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"stale","body":"","expectedVersion":1}'
curl -s 'http://localhost:8787/notes?limit=1'
```

Replace `<id>` with the `id` from the first response. The second command returns the note at version 2, and the third returns a 409 together with the stored note.

The in-memory implementation is enough for checking the shape and the rules of the API. It tells you nothing about DynamoDB itself, though.

### Against DynamoDB Local

DynamoDB Local is a simulation of DynamoDB distributed by AWS. It runs as a container. It requires a running Docker daemon, which doesn't come with the devShell.

```bash
vp run db:local:start
vp run db:migrate:local
vp run db:seed:local
```

`db:migrate:local` creates the table, and `db:seed:local` loads the notes in `test/fixtures/seed-notes.json`. Change `NOTES_STORE` in `.env` to `dynamodb` and start `vp run dev:notes`, and the API uses this table. To start over, run `vp run db:reset:local`; to stop and remove the container, run `vp run db:local:stop`.

These tasks refuse to run unless the endpoint is `localhost`. You can't delete a table in real AWS by accident.

Compared with local development on D1, there are two differences. With D1, starting `wrangler dev` is all it takes to have a local database, whereas here you start the simulation yourself. And D1 migrations apply SQL files in order, whereas DynamoDB has no column definitions, and the only thing you decide for the table is the keys. The local table is created by `scripts/local-db.ts`, and the table on AWS by CDK. These two definitions are kept in sync by hand.

DynamoDB Local is still only a simulation. You can check that the expressions are accepted and that they behave as intended on a single machine. It doesn't reproduce IAM, throttling, or the replication and latency of the real service.

To be honest, the DynamoDB Local tasks in this section haven't been run yet. A Docker daemon wasn't available at the time of writing.

## Tests

<!-- section: 05.tests -->

```bash
vp run test:unit
vp run test:local:dynamodb
```

The tests come in five layers. Each one looks at something different.

| Layer | File | What it looks at | What it can't see |
| --- | --- | --- | --- |
| Contract (in memory) | `test/repository-contract.ts`, `test/memory-repository.test.ts` | The rules of the repository: no overwrites, the version, paging, separation between owners | DynamoDB's behavior |
| Request inspection | `test/dynamodb-repository.test.ts` | The condition expressions, key shapes, and consistency settings sent to DynamoDB. Handling of a failed condition | That DynamoDB behaves as those requests ask |
| Contract (DynamoDB Local) | `test/dynamodb-local.test.ts` | That the same rules hold on the simulation | IAM, throttling, the distributed behavior of the real service |
| App and client | `test/app.test.ts` | 409, paging, rejection of a forged cursor, a retry after a lost response | Behavior when the request goes through Lambda and API Gateway |
| Infrastructure | `infra/test/notes-stack.test.ts` | That the permissions are limited to five operations and one table, and the table's removal policy | That AWS behaves as the template says |

The contract tests state the rules once and run them for each implementation.

The DynamoDB implementation gets a stand-in for the SDK client, and the tests inspect the requests it sends. If someone removes one of the parts that carry the guarantees (`ConditionExpression`, `ConsistentRead`, the shape of the keys), this test fails. But this only confirms that "the right requests are being sent". How DynamoDB handles those requests is checked against DynamoDB Local or real AWS.

`test:local:dynamodb` fails when `DYNAMODB_ENDPOINT` is not set. The test file itself skips when there is no endpoint. A skipped test looks like a success at a glance, so the dedicated task turns it into a failure. The `1 skipped` in the output of `vp run test:unit` is this test.

For concurrent writes, the contract tests include a check that "of two writes carrying the same version, exactly one goes through". In the in-memory implementation this always holds, because the writes run one after the other inside a single process.

Let's be honest about this part. Where it really needs to be checked is on DynamoDB, and that has never been run. So the central claim of this chapter, that "a conditional write lets exactly one of several concurrent updates through", is unconfirmed on DynamoDB. What has been checked is that the right condition expressions are sent and that the in-memory implementation follows the same rules. The statements about DynamoDB's behavior are based on the official documentation.

## Getting ready for AWS

<!-- section: 05.infra -->

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{table}

`billingMode` is on-demand. You are charged for the number of reads and writes and don't have to decide capacity in advance. The other option is provisioned, where you decide the read and write capacity per second and pay for the time it is provisioned. If traffic is steady and predictable, provisioned can be cheaper, but it also costs money during the time you don't use it. On-demand suits learning, and new apps whose traffic can't be predicted.

`removalPolicy` is `DESTROY`. Delete the stack and the table goes with it, along with every note in it. That's because this is for practice. A test goes out of its way to check this setting, since it's the first place to change once you start storing data that has to be protected.

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{role}

Writing `table.grantReadWriteData(role)` would do this in one line. But those permissions also include `Scan`, which reads the whole table, and the operations that read and write in batches. This app uses none of them. A permission that isn't used only widens what can be abused if the code has a defect, so the five operations are listed one by one. The test checks that the operations are these five and that the resource is the ARN of this table only.

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{function}

`TABLE_NAME` passes the table's name, which is determined at deploy time, to the function as an environment variable. The name isn't written in the code.

`externalModules: []` tells the bundler to include the AWS SDK in the bundle. If nothing is specified, the SDK is left out of the bundle and the version that ships in the Lambda runtime is used. That version has nothing to do with this repository's lockfile. With the SDK included, the version that runs is the one that was tested. The price is a larger bundle.

## Deploy it and check

<!-- section: 05.deploy -->

```bash
vp run notes:infra:diff
vp run notes:infra:deploy
vp run notes:smoke
```

`notes:smoke` uses the typed client to create one note, read it back, update it, check that an update with a deliberately old version is rejected, and finally delete it. Unlike the chapter 04 smoke task, the read-back has to succeed no matter which execution environment answers.

You can look at the contents of the table in the DynamoDB console, under "Explore items".

The drift check is the same as in the earlier chapters.

```bash
vp run notes:infra:drift
```

`AWS::DynamoDB::Table` is a type that the pinned version of cdkd handles with a dedicated implementation. The result against real AWS hasn't been checked yet.

## When DynamoDB doesn't fit

<!-- section: 05.fit -->

This chapter's design worked because there were only two ways of reading. DynamoDB becomes a struggle when requirements like these come up.

- Queries that are added later and aren't decided in advance. Conditions such as "notes whose body contains a certain word" or "notes updated last month, for all owners" are not in the key, so they mean reading the whole table
- Aggregations and joins across several kinds of data
- Constraints that span several items. A rule such as "at most 100 notes per user" can't be kept by a conditional write on one item. There is a transaction feature, but it has limits on the number and size of items it can handle at once

There is also a limit of 400 KB per item. Large data such as images doesn't go in an item; it goes in S3 (chapter 07, planned).

If requirements like these are central, a SQL database is the more straightforward choice. Chapter 13 (planned) compares Aurora DSQL, RDS for PostgreSQL, and Aurora Serverless v2. If you're used to D1, that should be the closer experience. DynamoDB isn't "D1 without SQL". It's a different kind of tool.

### If you want it in several Regions

DynamoDB has a feature called global tables, which keeps replicas of a table in several Regions. This book doesn't implement it, but here is what to check when you choose it.

According to the official documentation (the read consistency page), global tables have two consistency modes. In the default mode, changes are usually replicated to the other Regions within 1 second, and across Regions the table is eventually consistent. In the other mode, a write is replicated synchronously to another Region before it returns its response.

Whether this chapter's optimistic locking holds unchanged should depend on the mode. In the default mode, changes are replicated asynchronously, so the evaluation of a condition in one Region may not yet see a write that was made a moment ago in another Region. This is an inference from the description of replication; it has not been confirmed directly in the official documentation. Either way, don't assume from the name "global" that conditional writes take effect across Regions. Before using it, check the mode, the supported Regions, and the scope of transactions in the official documentation as it stands at that time.

## Let's talk money

Amounts are in USD, for the Tokyo Region, on-demand, before tax. The inputs and unit prices behind the calculations are in [Pricing Worksheets](/en/reference/pricing.md).

While nobody uses it, the only charge is the table's storage. In the Tokyo Region the first 25 GB is free, and anything beyond that is USD 0.285 per GB per month. This free amount is listed as a tier in the published price list. If the notes take up 10 MB, the charge is 0.

Once it is used, usage is counted in units of reads and writes.

| Item | Unit price | How it is counted |
| --- | --- | --- |
| Writes (write request unit) | USD 0.715 per 1 million | 1 for writing one item of up to 1 KB |
| Reads (read request unit) | USD 0.1425 per 1 million | For one item of up to 4 KB, 1 if strongly consistent and 0.5 if eventually consistent |

Let's work it out for 1 million requests per month. The breakdown is 70% lists, 20% reads of one note, 8% creates and updates, and 2% deletes, and each list reads 20 KB with eventual consistency. Lambda runs at 256 MB on arm64, with an assumed average duration of 60 ms, longer than in chapter 04 by the time spent calling DynamoDB. That figure is not a measurement.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| API Gateway HTTP API | 1 million | 1.29 | 1.29 (a free allowance could not be confirmed, so none is subtracted) |
| Lambda requests and duration | 1 million, 15,000 GB-seconds | 0.40 | 0 |
| CloudWatch Logs | 0.477 GB | 0.37 | 0 |
| DynamoDB reads | 1.95 million units | 0.28 | 0.28 |
| DynamoDB writes | 100,000 units | 0.07 | 0.07 |
| DynamoDB storage | 1 GB | 0.00 | 0.00 |
| Subtotal | | **2.41** | **1.64** |

The part of this calculation that is easiest to move is the list reads. Out of the 1 million requests overall, lists use 90% of the DynamoDB read request units. Reducing the number of notes per page, or leaving the body out of the list, brings it down. Going the other way, making the list strongly consistent doubles this row.

An update that is rejected because of a conflict also consumes write request units. This calculation assumes no conflicts.

Two things are left out of this table: the data transfer charge for responses, and point-in-time recovery (when enabled, it adds a storage charge of USD 0.228 per GB per month; it is disabled in this chapter).

Delete the stack and the table is deleted with it. Nothing remains.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| `dev:notes` stops with `Invalid environment` and shows `NOTES_STORE` | Does `examples/05-dynamodb/.env` exist? |
| It starts with `NOTES_STORE=dynamodb` and the first request is a 500 | Is DynamoDB Local running (`db:local:start`)? Did you create the table (`db:migrate:local`)? Look for `ResourceNotFoundException` in the logs |
| After deployment, a 500 with `AccessDeniedException` in the logs | The code is calling an operation that isn't in the execution role. The message shows the operation name (such as `dynamodb:Scan`) and the table's ARN |
| After deployment, a 500 with `ResourceNotFoundException` in the logs | The table that `TABLE_NAME` points to doesn't exist. Are you looking at a different Region? |
| Every update is a 409 | Is the `expectedVersion` you send the `version` of the note you received most recently? Use the value from the response to the last update, not from the creation response |
| A note you created doesn't appear in the list right afterwards | This can happen with eventually consistent reads, as "Choose the read consistency" explains |
| The list ends partway through | Are you reading until `nextCursor` is `null`? |
| The logs show errors that indicate throttling | A new on-demand table has an initial limit on the traffic it can accept. Are you sending a large amount of traffic all at once? |

## If you take this to production

- **Add authentication and separation between owners.** Right now everyone reads and writes the same notes (chapter 06)
- **Protect the table.** Set `removalPolicy` to `RETAIN`, and enable deletion protection and point-in-time recovery. The procedure for restoring data deleted by accident is planned for chapter 22
- **Set a limit on traffic.** An on-demand table lets you set maximum reads and writes per second. A public API with no limit has no limit on its cost either
- **Make creation idempotent.** This fixes the duplicates caused by retries (chapter 08, planned)
- **Watch throttling and failures.** Look at DynamoDB errors and the proportion of 409s (chapter 19, planned). A high proportion of 409s is a signal to reconsider how the screen is built or how notes are divided up
- **Deploy through the AWS CDK CLI and CloudFormation.** As discussed in chapter 02

## Clean up

<!-- section: 05.cleanup -->

```bash
vp run notes:infra:destroy
vp run db:local:stop
```

`notes:infra:destroy` deletes the table, the function, the role, the API, and the log group. All the notes in the table are deleted too, and they can't be restored. This stack takes no backups, so that's the one thing to be careful about.

`db:local:stop` removes the local DynamoDB Local container. It is started with a setting that keeps the data in memory, so the contents go with it.

All that remains is the storage locations created by the cdkd bootstrap (chapter 02) and the deployment files placed in them.

::: details Verification notes for this chapter

**Checked locally.** The contract tests (in memory), the inspection of the requests sent to DynamoDB, the app and client tests, and the infrastructure assertions. Type checking. Synth (a bundle that includes the AWS SDK). Starting `dev:notes` in memory and running the `curl` commands from the text.

**Not checked yet.** The tasks that use DynamoDB Local (`db:local:start`, `db:migrate:local`, `db:seed:local`, `db:reset:local`, `db:local:stop`, `test:local:dynamodb`) were not run, because a Docker daemon was not available at the time of writing. `notes:infra:diff`, `notes:infra:deploy`, `notes:smoke`, `notes:infra:drift`, and `notes:infra:destroy` have not been run against real AWS either.

So the central claim of this chapter, that "a conditional write lets exactly one of several concurrent updates through", has never been checked on DynamoDB. What has been checked is that the right condition expressions are sent and that the in-memory implementation follows the same rules. The statements about DynamoDB's behavior are based on the official documentation.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Derive the keys from how you read | `examples/05-dynamodb/src/dynamodb-repository.ts`, `src/id.ts`, `src/notes.ts` | `test:unit` |
| Add a version to the contract | `examples/05-dynamodb/src/contract.ts` | `test:unit` |
| Swap the storage | `examples/05-dynamodb/src/repository.ts`, `src/memory-repository.ts`, `src/dynamodb-repository.ts`, `src/compose.ts` | `test:unit` |
| Prevent overwrites: conditional writes | `examples/05-dynamodb/src/dynamodb-repository.ts`, `src/app.ts`, `test/repository-contract.ts`, `test/dynamodb-repository.test.ts` | `test:unit` |
| Choose the read consistency | `examples/05-dynamodb/src/dynamodb-repository.ts`, `test/dynamodb-repository.test.ts` | `test:unit` |
| Page through without dropping items | `examples/05-dynamodb/src/repository.ts`, `src/app.ts`, `src/contract.ts`, `test/app.test.ts` | `test:unit` |
| When the response never arrives | `examples/05-dynamodb/src/client.ts`, `test/app.test.ts` | `test:unit` |
| Run it on your machine | `examples/05-dynamodb/src/dev.ts`, `src/env.ts`, `test/env.test.ts`, `scripts/local-db.ts`, `test/fixtures/seed-notes.json`, `.env.example` | `dev:notes`, `db:local:start`, `db:migrate:local`, `db:seed:local`, `db:reset:local`, `db:local:stop` |
| Tests | `examples/05-dynamodb/test/`, `scripts/test-local.ts` | `test:unit`, `test:local:dynamodb` |
| Getting ready for AWS | `examples/05-dynamodb/infra/lib/notes-stack.ts`, `infra/bin/app.ts`, `infra/test/notes-stack.test.ts`, `cdk.json` | `notes:infra:synth`, `test:unit` |
| Deploy it and check | `examples/05-dynamodb/src/lambda.ts`, `scripts/smoke.ts`, `tools/src/infra/` | `notes:infra:diff`, `notes:infra:deploy`, `notes:smoke`, `notes:infra:drift` |
| Clean up | `tools/src/infra/` | `notes:infra:destroy`, `db:local:stop` |
| Let's talk money | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

**Primary sources** (all checked 2026-10-11)

- [DynamoDB read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html)
- [DynamoDB condition expression CLI example](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
- [Paginating table query results in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html)
- [DynamoDB on-demand capacity mode](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html)
- [Constraints in Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html)
- AWS Price List bulk API: [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)
- [Cloudflare D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
