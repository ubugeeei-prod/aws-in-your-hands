---
title: "49 Athena: Deploy"
---

# 49 Athena: Deploy

## Deploy and check

<!-- section: 49.deploy -->

From here you deploy to AWS and run the [statements you printed locally](/en/chapters/49-athena/local.md) in Athena. The steps on this page have not been run against a real AWS account yet. Whether the SQL is accepted at all is something this page is the first to find out.

Deploy chapter 26's stack first and put a few records in. This chapter's stack is given the name of chapter 26's bucket, which is the `LakeBucketName` output of that stack.

```bash
vp run analytics:infra:deploy
vp run analytics:smoke
vp run athena:infra:diff -c lakeBucketName=<LakeBucketName>
vp run athena:infra:deploy -c lakeBucketName=<LakeBucketName>
```

The workgroup's name, `aih-athena`, is fixed in the stack. If the same account and Region already have a workgroup of that name, creation fails.

Once chapter 26's buffer interval (60 seconds) has passed, run the query with parameters. Days are in UTC.

```bash
vp run athena:run --name route --from 2026-10-13 --to 2026-10-13 --route /notes
```

`athena:run` prints the statement and its parameters, hands them to Athena, waits up to two minutes, and prints the rows and the bytes scanned. If the query has not finished in two minutes, it stops the query and exits. Right after the smoke test, `/notes` should show one 201. The bytes scanned may be a few hundred, and the charge is still for the 10 MB minimum.

Run the same query again, this time accepting a reused result.

```bash
vp run athena:run --name route --from 2026-10-13 --to 2026-10-13 --route /notes --reuse 60
```

If the previous result is used, it should print `A stored result was reused`.

Next, create the derived tables. Each DDL statement is run once.

```bash
vp run athena:run --name create-compact
vp run athena:run --name compact --from 2026-10-13 --to 2026-10-13
vp run athena:run --name create-iceberg
vp run athena:run --name merge --from 2026-10-13 --to 2026-10-13
vp run athena:run --name merge --from 2026-10-13 --to 2026-10-13
```

`merge` is there twice to check that the second run adds no rows. `compact` doubles the rows when it runs twice. If you try that, do it in order to see it happen.

The limit cannot be seen at work until the records pass 1 GiB. Practice data does not get there, so to check it, lower the workgroup's limit to 10 MB for a while and run a query that reads several days.

The saved queries should be visible in the Athena console once you switch the workgroup to `aih-athena`. The console screens were not checked.

Whether what is deployed still matches its definition is checked as in the other chapters.

```bash
vp run athena:infra:drift
```
