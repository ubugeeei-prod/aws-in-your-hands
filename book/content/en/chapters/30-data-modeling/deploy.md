---
title: "30 Data Modeling: Deploy"
---

# 30 Data Modeling: Deploy

The design that ran locally now goes to AWS. The stack holds the table with its index and stream, the Lambda function that reads the stream, a queue for the batches it gives up on, and the permissions to hand to the application. There is no API in it.

## Getting ready for AWS

<!-- section: 30.infra -->

<<< @/examples/30-data-modeling/infra/lib/modeling-stack.ts{limits}

As in chapter 05, the on-demand table gets a per-second limit. The write limit is higher than chapter 05's 40. The largest write is the transaction that writes a note with a full-length body together with eight tags and a slug, about 82 units. Chapter 05 did not find out whether a single write larger than the limit goes through, and neither did this chapter, so the limit sits above it.

The index has a limit of its own. Index entries carry no body and are small, so its numbers can be small. But the index's write limit has the power to stop writes to the table. Do not set it too low.

The table's definition is shown under "Hot partitions" in [Build, Continued](/en/chapters/30-data-modeling/more.md), and the index's under "An index for a second sort order" in [Design and Build](/en/chapters/30-data-modeling/build.md). `removalPolicy` is `DESTROY`: this is practice data, and deleting the stack deletes everything in the table.

### Permissions for the application

This stack has no function that calls the notebook. Instead it creates one managed policy that can be attached to the role of the function from chapter 06 or 07.

<<< @/examples/30-data-modeling/infra/lib/modeling-stack.ts{app-policy}

To chapter 05's five operations it adds `dynamodb:ConditionCheckItem`. There is no permission called `TransactWriteItems`. According to the documentation, a `Put`, `Update`, or `Delete` inside a transaction is decided by the `PutItem`, `UpdateItem`, or `DeleteItem` permission, and a `ConditionCheck` by `ConditionCheckItem`.

An index is a resource separate from its table. Its ARN is `table/<table name>/index/<index name>`, and permission on the table's ARN does not extend to it. A second statement allows `Query` on the index.

`Scan` and the batch operations are again left out. The migration scripts use `Scan`, and run with the credentials of whoever runs them.

### Permissions for the stream function

<<< @/examples/30-data-modeling/infra/lib/modeling-stack.ts{projector-role}

All the function does to the table is one transaction made of a `Put` for the marker and an `Update` for the count. It never reads or deletes, so it has two permissions.

Lambda is what reads the stream, and it uses the function's role to do so. Three operations are allowed on the stream's ARN.

Only `dynamodb:ListStreams` has `*` as its resource. That operation cannot name a resource: the IAM service reference lists no resource type for it. The other stacks in this book avoid `*`, but here there is nothing to narrow it to, so a test pins that this is the only use of `*`. Whether Lambda really needs this permission to create the event source mapping was not checked on AWS. It is included because the AWS managed policy `AWSLambdaDynamoDBExecutionRole` includes it.

<<< @/examples/30-data-modeling/infra/lib/modeling-stack.ts{dead-letters}

The event source mapping is shown under "Derived data from Streams" in [Build, Continued](/en/chapters/30-data-modeling/more.md).

Of the types this stack uses, the pinned cdkd (0.296.28) registers dedicated providers for `AWS::DynamoDB::Table`, `AWS::IAM::ManagedPolicy`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::EventSourceMapping`, `AWS::Lambda::Function`, `AWS::Logs::LogGroup`, and `AWS::SQS::Queue`. That was checked in the installed package. `AWS::SQS::QueuePolicy` is a type chapter 08's stack already uses.

## Deploy and check

<!-- section: 30.deploy -->

```bash
vp run modeling:infra:diff
vp run modeling:infra:deploy
vp run modeling:smoke
```

`modeling:smoke` uses your own credentials to create one note in the deployed table, add an attachment, and check that one `Query` returns both. Then it waits for the two things that arrive late.

<<< @/examples/30-data-modeling/scripts/modeling.ts{smoke}

It rereads every 250 ms until the note appears in the index's list, and until the stream function has written the tag count, and prints how long each took to be seen. That time includes the polling interval and the round trip from your machine to AWS. It is a rough guide, not the lag of the index or the function.

Last, it deletes the note and waits for the tag count to return to 0. The counter items (`QUOTA` and `TAGCOUNT#smoke`) and the markers the function wrote stay in the table. TTL removes the markers.

The function's logs are in the log group named by the stack output `ProjectorLogGroupName`. Each invocation logs one line with the number of records received, applied, and recognized as duplicates.

The drift check is the same as in earlier chapters.

```bash
vp run modeling:infra:drift
```

To turn on Contributor Insights, deploy with `-c insights=on`. It is billed monthly for two rules. A later deploy without the flag turns it off again, so to keep it, put it in the `context` of `cdk.json`.

```bash
vp run modeling:infra:deploy -c insights=on
```

### Moving an existing table

To move the table from chapters 05 to 08 to the new shape, follow "Move keys without stopping" in [Build, Continued](/en/chapters/30-data-modeling/more.md). After adding the index to that table's stack and deploying, use these tasks.

```bash
vp run modeling:backfill --table <table name>
vp run modeling:backfill --table <table name> --apply
vp run modeling:verify --table <table name>
vp run modeling:remove-legacy --table <table name>
```

`modeling:backfill` and `modeling:remove-legacy` only print how many items they would write or delete, and change nothing, unless `--apply` is given. `modeling:backfill` prints, after each page, where to resume in the form `--after` takes. `modeling:verify` lists the items that do not have the new shape yet and exits with a failure if there is even one.

None of the tasks in this section has been run on real AWS.
