---
title: "58 Ledger: Deploy"
---

# 58 Ledger: Deploy

This page puts the ledger on AWS. The stack holds the table, the locked bucket, the Lambda function that takes digests with its schedule, and the permissions for the writer and the auditor. It has no API.

The steps on this page are prepared and have not been run.

## The stack

<!-- section: 58.stack -->

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{table}

The table is on-demand, with just the two keys. Its `removalPolicy` is `DESTROY`, so destroying the stack deletes the entries. That is a practice setting.

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{bucket}

The bucket has versioning and Object Lock enabled, and a default retention period. An object version written to it is locked for that period even when the request says nothing about it.

**This bucket's `removalPolicy` is `RETAIN`.** A stack cannot delete a bucket that still holds locked versions. Rather than try and fail, it leaves the bucket from the start. You clean it up yourself once the retention period is over.

The retention mode and period come from context.

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{lock}

The default is governance mode for one day. A digest made while practising can be deleted the next day. With `-c lockMode=compliance -c lockDays=2557` you get objects that nobody, the root user included, can delete for about seven years. Compliance mode is not something to try out. A wrong period cannot be shortened, and the bucket stays until that day.

<<< @/examples/58-ledger/infra/test/ledger-stack.test.ts{lock-test}

### Permissions for the writer, the function, and the auditor

The writer's policy is on [Design and Build](/en/chapters/58-ledger/build.md): `dynamodb:PartiQLInsert` and `dynamodb:Query`, nothing else. Attach that managed policy to the role of the function that serves the notes API.

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{digester}

The function that takes digests reads the table and writes objects under one prefix. It cannot write the table. It has no permission to delete an object version or to lift a governance-mode lock.

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{auditor}

The auditor's role can read both the table and the bucket and can write neither. Listing versions is `s3:ListBucketVersions` and reading a named version is `s3:GetObjectVersion`. Both are actions separate from `s3:ListBucket` and `s3:GetObject`.

No role in the stack has a permission to update or delete an item, or to delete an object version. A test lists the names of the actions that must not appear and checks that they are nowhere in the template.

Even so, an administrator of the account can rewrite the table whatever these roles say. What you have then is the locked digests, and CloudTrail. Recording reads and writes of items in CloudTrail takes data events enabled on a trail, which costs money (chapter 21).

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{schedule}

The schedule's interval is how long unprotected entries can exist. A shorter interval narrows the gap and sends more requests to S3. You could write a digest on every append, but each append then adds one S3 `PutObject`, which at the Tokyo Region's prices is a little over six times one write unit in DynamoDB.

The pinned cdkd (0.296.28) registers a dedicated implementation for every type this stack uses: `AWS::DynamoDB::Table`, `AWS::Events::Rule`, `AWS::IAM::ManagedPolicy`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::Logs::LogGroup`, `AWS::S3::Bucket`, and `AWS::S3::BucketPolicy`. I also confirmed in the installed package that the bucket implementation has code to enable Object Lock at creation and to set the default retention. That it really creates them has not been confirmed.

## Deploy and check

<!-- section: 58.deploy -->

```bash
vp run ledger:infra:diff
vp run ledger:infra:deploy
vp run ledger:append
vp run ledger:append
vp run ledger:digest
vp run ledger:append
vp run ledger:verify
```

`ledger:append` appends one sample event with your own credentials. `ledger:digest` runs, once and from your machine, the same code the scheduled function runs, and writes a digest to the bucket. It is there so you need not wait an hour for the function. `ledger:verify` reads every entry in the table and every version of every digest and prints the result. Run in this order, it should show three entries, one digest, one entry not yet covered, and no findings. With even one finding the task ends in failure.

The function's logs are in the log group named by the `DigestLogGroupName` output. Every hour there is one line saying `written`, `unchanged`, or `empty`.

To try a rewrite on AWS, edit one item of the table in the console and then run `ledger:verify`. You can edit it because you are an administrator. A role with only the writer's policy should be refused the same edit, which has not been confirmed either.

`ledger:infra:drift` checks whether the stack's settings have been changed. If the bucket's default retention has been shortened, it should show here. According to the user guide, the default retention is turned into a date for each version when the object is written. The date of a version that is already locked does not move when the default changes.

Before cleaning up, note the `DigestBucketName` output. Once the stack is destroyed its outputs are gone. The rest is in [Costs, Pitfalls, and Cleanup](/en/chapters/58-ledger/wrap.md).
