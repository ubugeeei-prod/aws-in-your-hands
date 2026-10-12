---
title: "60 Aurora: Design and Build"
---

# 60 Aurora: Design and Build

The [previous page](/en/chapters/60-aurora.md) listed three things an application does at a failover. This page solves the third, the transaction whose outcome is unknown, with an idempotency key, and checks it with tests that drop the connection. Then it moves on to Serverless v2 capacity, the Data API, and the stack.

## The invariant, and applying exactly once

<!-- section: 60.invariant -->

In one sentence, this is what must hold.

> A transaction interrupted by a failover is either committed or retried whole, never half applied and never applied twice.

The first half, "never half applied", is kept by the database. When a connection drops, the server rolls back whatever was not committed. The second half, "never applied twice", only the application can keep.

Chapter 13's create and update happened to be safe to run twice. Create fixed the note's ID outside the transaction, so a retry produces the same one note. Update names the version it expects, so a second run matches nothing and writes nothing. This chapter adds one operation that is not like that: appending text to the end of a note's body.

<<< @/examples/60-aurora/src/append.ts{append}

An append request does not say which version it appends to. Run it twice and the text is added twice. Incrementing a counter and subtracting from a balance have the same shape.

Types are written into the SQL, as in `CAST($2 AS uuid)`, so that the same statement can be used with the Data API later. How a parameter passed as a string is typed can differ from driver to driver, so the statement does not rely on it and says what each column needs.

### A table that records requests

To know whether a retry is allowed, you must be able to find out afterwards whether the earlier attempt was committed. So there is a table with one row per request that was applied.

<<< @/examples/60-aurora/migrations/0005_create_requests.sql

`key` is the idempotency key. The client makes one for each thing the user did and sends it along. When no answer comes back and the client sends the request again, it sends the same key. Keys are kept apart per owner, so guessing someone else's key does not show you their result.

This migration continues the numbering after chapter 13's four. It passes chapter 13's lint (one statement per file, with `IF NOT EXISTS`) as it is.

### The way into a transaction

The retrying side receives its way into the database as one type: a single attempt, which is to begin, run the body, and commit.

<<< @/examples/60-aurora/src/once.ts{port}

`transactional` puts chapter 13's `Db` (PGlite and node-postgres) into that shape. Chapter 13 asked for `REPEATABLE READ` to match Aurora DSQL; here the level is left at PostgreSQL's default, `READ COMMITTED`. The implementation for the Data API comes in a later section.

### Applying exactly once

<<< @/examples/60-aurora/src/once.ts{once}

It does three things.

1. At the start of the transaction it looks for the key. If the key is there, the earlier attempt was committed, so it returns the recorded result without running the body
2. If not, it runs the body and writes the result with the key **in the same transaction**
3. If the attempt ends without an answer, it starts again from the beginning

The second step is the one everything rests on. The append and the record of the key are one transaction, so either both are in or neither is. That is why looking for the key is enough to know whether the append went in. Write the key in another transaction, or in another data store, and that relationship is gone.

What is recorded is not a mark saying "applied" but the result itself. A retried attempt returns what the first attempt would have answered, not what the note looks like now. Even if another append got in between, the client receives the same answer. A stored result, like any row from the database, comes from outside the type system, so it is checked against the schema when it is read.

When `INSERT ... ON CONFLICT DO NOTHING` returns no row, another request with the same key committed before this one. This attempt's body has already run, so it throws, rolls back, and starts over. The next attempt finds the other's result in step 1.

If no answer is obtained however many times it tries, it throws `AttemptsExhaustedError`. That exception does not mean "failed". It means "the outcome is not known". A client that sends the same key again receives the recorded result if the request was applied, and the result of applying it now if it was not.

Keys only need to remain for as long as a client might still resend. Old rows are deleted.

<<< @/examples/60-aurora/src/once.ts{purge}

## Tests that drop the connection

<!-- section: 60.faults -->

An invariant is checked by trying to break it. The local database is PGlite, as in chapter 13. PGlite is PostgreSQL inside the process, with no failover and no second connection. So what a client sees when a connection drops is reproduced by this wrapper.

<<< @/examples/60-aurora/test/support.ts{drop}

There are two ways to drop. `before` is the case where the connection is lost before the statement reaches the server. `after` is the case where the statement ran and the connection is lost before the answer arrives. In both, the server rolls back what was not committed and the client receives only a `ConnectionLostError`. Dropping `COMMIT` with `after` gives the situation where the change is in and the client cannot tell.

Only the order of events as the client sees it is reproduced. Which error node-postgres reports in a real failover, and how many seconds pass before the connection is seen as dead, cannot be learned from this wrapper.

When nothing goes wrong, an append is five statements: `BEGIN`, the `SELECT` that looks for the key, the `UPDATE` that appends, the `INSERT` that writes the key, and `COMMIT`. The connection is dropped before and after each of the five, at ten points in all.

<<< @/examples/60-aurora/test/once.test.ts{every-point}

Wherever it drops, the caller receives the answer it would have received had nothing happened, and the note has been appended to exactly once.

What happens without a key is a test as well.

<<< @/examples/60-aurora/test/once.test.ts{naive}

<<< @/examples/60-aurora/test/once.test.ts{twice}

After the answer to `COMMIT` is lost, the same append runs again, so the body becomes `abb`. The caller receives the second result and has no way to notice that the text was added twice.

There is one thing PGlite cannot do: two requests with the same key running at once on separate connections. PGlite has one session, so that case is only a test that scripts the answer "the `INSERT` returned no row". It was not checked with two connections to a real PostgreSQL.

Run the tests with this command.

```bash
vp test run examples/60-aurora
```

## Serverless v2 capacity

<!-- section: 60.serverless -->

An Aurora instance is either provisioned, where you choose a size and rent it, or Serverless v2, where the size follows the load. One cluster can mix the two. This chapter's instance is Serverless v2, with the instance class `db.serverless`. AWS's current documentation calls the feature Aurora serverless; Serverless v1 is a deprecated product of a different design.

Capacity is measured in ACUs (Aurora capacity units). One ACU is about 2 GiB of memory with the CPU and networking to match. You set a minimum and a maximum on the cluster, and each instance grows and shrinks within that range in steps of 0.5 ACU. The range is 0 to 256 ACUs, and you pay for the ACUs actually used multiplied by time.

Scaling happens while connections are open and transactions are running, and does not stop work in progress. How fast capacity grows depends on the capacity at that moment: the larger, the faster. A small minimum hit by a sudden large load takes time to catch up. On PostgreSQL with a minimum of 0 or 0.5 ACU, `max_connections` is also capped at 2,000.

The settings arrive as context for the stack, and values the service would refuse are refused before synthesis.

<<< @/examples/60-aurora/src/config.ts{config}

### Scaling to zero

With a minimum of 0 ACU, an instance pauses when there has been no user connection for a set time. This is called auto-pause. The wait is between 300 and 86,400 seconds, 300 by default. On Aurora PostgreSQL it needs 13.15, 14.12, 15.7, 16.3, or later. While paused, the instance charge is zero and the storage charge remains.

A paused instance resumes on the next connection. Resuming typically takes about 15 seconds, and can take 30 seconds or more after more than 24 hours paused. Capacity right after a resume starts small, whatever it was before the pause.

What prevents a pause goes straight to the bill, so it is worth remembering.

- Any user connection is open, even one that is running nothing
- An RDS Proxy is attached. The proxy keeps its connections
- Logical replication, zero-ETL, or Global Database is in use

Aurora resumes an instance for maintenance at times, and then does not pause it again for at least 20 minutes. "Paused for the whole month" is the most favourable case.

An application with a connection pool collides with this. As long as the pool holds a connection, the instance does not pause. The adapter for connecting with node-postgres from inside the VPC closes idle connections after 10 seconds, and has a connection timeout longer than a resume takes.

<<< @/examples/60-aurora/src/pg.ts{pool}

`keepAlive` is there for failover. When the instance at the other end disappears, a TCP connection can go on waiting without noticing that it is dead. The AWS documentation recommends short keepalives to detect this early (as operating system settings: 1 second to the first probe, 1 second between probes, 5 probes). What node-postgres lets you set is only the time to the first probe.

This adapter has passed the type check and has never been connected to a real cluster. Nothing in this chapter's stack runs inside the VPC, and from a laptop you use the Data API of the next section.

## The Data API

<!-- section: 60.data-api -->

The Data API sends SQL to Aurora over HTTPS. The caller holds no connection and does not know the database password. IAM decides whether the caller may call this API on this cluster and whether it may read this secret, and the Data API fetches the credentials from Secrets Manager and runs the SQL on a connection of its own.

That is how a Lambda function outside a VPC, or a laptop, reaches a cluster in private subnets. No VPC configuration for the function, no connection pool, and no RDS Proxy is needed. Holding no connection, it does not get in the way of auto-pause either.

Where it does not fit is just as clear. The documentation read on 2026-10-13 gives these limits.

- Everything runs on the writer. Reads cannot be sent to a reader
- A call is cancelled after 45 seconds by default. A response is at most 1 MiB, and one row of a result at most 64 KB
- A transaction is rolled back automatically when no call uses its ID for three minutes, and lasts 24 hours at most
- One call carries one statement
- It is not available on T instance classes
- Every statement is one HTTPS round trip, and requests are billed (USD 0.42 per million in Tokyo)

In the Tokyo Region it works with Aurora PostgreSQL 13.11, 14.8, 15.3, 16.1, 17.4 and later, on Serverless v2 and provisioned instances alike.

In short, the Data API suits a caller that calls seldom, does little per call, and should stay out of the VPC: a Lambda function that writes now and then, or an administrative script. An API that sends several queries per request, or a read-heavy application that wants readers, is better served by a connection from inside the VPC.

### No retries by the SDK

The Data API client is created with one setting that differs from the default.

<<< @/examples/60-aurora/src/data-api.ts{client}

By default the AWS SDK sends a call again by itself when no answer came back. If that happens inside a transaction and the first call had in fact arrived, the same statement runs twice within one transaction. The append is added twice and then committed. The key is written once per transaction, so the key cannot prevent this duplicate.

The AWS documentation says the same: when the SDK reports a timeout and the operation still completed, a retry can produce duplicate data, and the SDK might retry automatically. So the SDK's retries are turned off, and every retry is left to `createOnce`, which starts the transaction over from the beginning.

### The adapter

Chapter 13's SQL uses parameters of the form `$1`. The Data API has named parameters, so they are rewritten.

<<< @/examples/60-aurora/src/data-api.ts{parameters}

The values accepted are strings, numbers, booleans, and `null`. Dates and UUIDs are passed as strings, and their types are settled by `CAST` in the SQL. The Data API also has `typeHint`, which sends a string as a timestamp or a UUID, but using it would make the SQL differ between drivers, so it is not used.

A result comes back as arrays of column values with the column metadata apart. It is turned into rows keyed by column name, as node-postgres returns them.

<<< @/examples/60-aurora/src/data-api.ts{rows}

There is also `formatRecordsAs`, which returns a result as one JSON string. According to the type definitions of the pinned SDK version, though, it applies to `SELECT` only. The append reads the row of an `UPDATE ... RETURNING`, so this form is used instead.

Errors are sorted into the classification made on the failover page.

<<< @/examples/60-aurora/src/data-api.ts{errors}

`DatabaseResumingException` is the answer that a paused instance is in the middle of resuming, and with auto-pause the code should be ready for it. `TransactionNotFoundException` is the answer that the transaction no longer exists; besides the three-minute timeout, it presumably also happens when the writer is replaced. Both are treated as "this attempt did not finish".

One thing differs from the connected path. `DatabaseErrorException` has no member carrying the SQLSTATE, so a deadlock or a serialization failure cannot be told from any other SQL error. On this path a conflict is not retried and goes back to the caller as an error.

<<< @/examples/60-aurora/src/data-api.ts{adapter}

`transaction` has the same shape as `transactional` in the earlier section. The only difference is that `BEGIN` and `COMMIT` are API calls and not SQL statements.

### Checking against a stand-in service

The Data API does not run locally. The tests use a stand-in that implements, on PGlite, only the four operations the adapter calls.

<<< @/examples/60-aurora/test/data-api.test.ts{fake}

The stand-in answers in the shapes the API reference documents (named parameters, the form of a `Field`, column labels), but it is not the Data API. It has one session, no timeouts, and none of the real exceptions. What it can confirm is that the SQL that went through the adapter's conversions runs on PostgreSQL, and the order of events when an answer is lost.

<<< @/examples/60-aurora/test/data-api.test.ts{lost-commit}

With the answer to `CommitTransaction` lost, the append still happens once. The result of the earlier section's tests holds on the other path too.

## The stack

<!-- section: 60.stack -->

The stack is four resources. The pinned CDK version also has a higher-level construct, `rds.DatabaseCluster`, but to show that the cluster and the instance are separate resources, the stack is written with the `Cfn` constructs that map directly to CloudFormation resources.

<<< @/examples/60-aurora/infra/lib/aurora-stack.ts{network}

The subnet group is the list of subnets instances may be placed in. It receives the private subnets of the chapter 11 VPC by importing that stack's outputs. Nothing written here changes the fact that the storage is in three Availability Zones.

The security group has no inbound rule at all. When you add a client inside the VPC, that client's stack adds a rule of its own to this group. That the Data API reaches the cluster without a rule in this group is read from the documentation's statement that it works without being put in a VPC, and was not checked.

<<< @/examples/60-aurora/infra/lib/aurora-stack.ts{cluster}

The cluster's definition has no instance size. What it has is the engine and version, the placement, encryption, the handling of credentials, and the Serverless v2 capacity range.

With `manageMasterUserPassword`, Aurora creates the password, keeps it in Secrets Manager, and by default rotates it every seven days. No password appears in the template. Rotation itself belongs to chapter 59 and [chapter 21](/en/chapters/21-security.md). This chapter's scripts pass the ARN of that secret to the Data API. In production you create a database user for the application with narrower privileges, and a secret for it. Running an application on the administrator's credentials is for practice only.

The engine version defaults to `17.9`. The release notes list it as a version from April 2026, and it meets the requirements of Serverless v2, the Data API, and auto-pause alike. Whether a new cluster can be created with it in the Tokyo Region today was not checked, however. If it cannot, choose another with `-c engineVersion=`.

<<< @/examples/60-aurora/infra/lib/aurora-stack.ts{writer}

An instance is a separate resource that points at the cluster. To add a reader you write the same resource once more. The first instance becomes the writer.

Being for practice, the cluster has deletion protection off and is deleted with the stack, without a final snapshot. Production does the opposite.

This command produces the template. It asks AWS nothing.

```bash
vp run aurora:infra:synth
```

The next page goes through deploying this stack.
