---
title: "13 SQL: Design and Build"
---

# 13 SQL: Design and Build

## Schema and migrations

<!-- section: 13.migrations -->

There are two tables.

<<< @/examples/13-sql/migrations/0002_create_owners.sql

<<< @/examples/13-sql/migrations/0003_create_notes.sql

A note's ID is a random UUID made by the application. On D1 you might reach for an `INTEGER PRIMARY KEY` counter, but the DSQL documentation advises against monotonically increasing primary keys on tables with many writes: every new row would land in the same place.

`note_count` in `owners` becomes the star later. For now, it is the column that counts toward "an owner may hold at most 100 notes". Thanks to that cap, a list always fits in one page. As in chapter 04, there is no pagination.

Here is the index.

<<< @/examples/13-sql/migrations/0004_index_notes_by_owner.sql

### One statement per file

A D1 migration file can hold as many statements as you like. Here, a file holds exactly one.

DSQL allows one DDL statement per transaction, so a file with several can never be made "all of it or none of it". With one statement to begin with, a file maps onto a transaction directly.

This is the runner.

<<< @/examples/13-sql/src/migrate.ts{migrate}

It does what D1 does: run the files in name order and write down how far it got, in a table (`public.aih_migrations`). The difference is at the comment in the middle.

The schema change and the record of it cannot share a transaction, because DDL and DML do not mix. So if the process dies after the change and before the record, you are left with "applied, but not recorded".

The next run sends the same statement again. That is why every statement is written so that running it twice is harmless (`IF NOT EXISTS`), and the lint above enforces it. The invariant for migrations: **if there is a record, the statement has been applied; a statement without a record gives the same result when run again.**

This, too, is checked by breaking it on purpose.

<<< @/examples/13-sql/test/migrate.test.ts{interrupted}

One more thing. If you edit a file that was already applied, the runner notices the changed checksum and stops. To fix something, add a file with a new number.

The local PostgreSQL does not know the word `ASYNC`. That one word is removed by the runner just before sending.

<<< @/examples/13-sql/src/migrate.ts{dialect}

The files are written in DSQL's SQL and the local side adapts. Not the other way around.

## Rows into types

<!-- section: 13.queries -->

The API contract is nearly the one from chapter 04, plus updates (`PUT`) and a `version`.

<<< @/examples/13-sql/src/contract.ts{note}

Between the application and the database there is one thin interface.

<<< @/examples/13-sql/src/db.ts{db}

`query` takes SQL text and numbered values such as `$1`. This chapter's application never puts a value into the SQL text. That way the door to SQL injection is not built in the first place.

Now, the `rows` that `query` returns are typed `unknown[]`. node-postgres will let you attach any type you like, but that is only a declaration of what you expect. Rename a column in a migration and the type stays as it was, while the runtime value changes.

A database row is a value from outside the type system, just like an HTTP request. So it gets the same treatment.

<<< @/examples/13-sql/src/db.ts{rows}

<<< @/examples/13-sql/src/notes-repository.ts{row}

The row schema doubles as the conversion from snake_case columns to the API's `Note`. Both node-postgres and PGlite return `timestamptz` as a `Date`, which becomes an ISO 8601 string.

Here is the update.

<<< @/examples/13-sql/src/notes-repository.ts{update}

`WHERE ... AND version = $6` is the point. If the `version` is still the one you loaded, the row is updated and the version moves by one. If not, no row is updated, and the current row is read and returned with a 409. The check and the write are one statement, so no other write fits in between.

The same SQL works on D1. That part of SQL is a pleasure.

## A transaction is retried as a whole

<!-- section: 13.transactions -->

From here on is where this chapter differs most from D1.

Creating a note first checks that the owner has not reached 100 notes. Written naively: count them, and `INSERT` if there is room. What happens when two of those run at once? Let's follow it with a cap of 2 and one note already there.

```figure
caption: With a quota of 2 and an owner who already has 1 note, of two transactions that run at once, B loses at commit, retries, and hits the quota
type: sequence
actor a: transaction A | POST /notes
actor db: Aurora DSQL
actor b: transaction B | POST /notes
step a -> db: t1 BEGIN (sees note_count = 1)
step b -> db: t2 BEGIN (sees note_count = 1)
step a -> db: t3 UPDATE owners SET note_count = 2
step a -> db: t4 INSERT INTO notes ...
step b -> db: t4 UPDATE owners SET note_count = 2
step a -> db: t5 COMMIT: ok
step b -> db: t5 INSERT INTO notes ...
step b -x db: t6 COMMIT: SQLSTATE 40001 (OC000)
note b: nothing of B is applied
step b -> db: t7 BEGIN again (sees note_count = 2)
step b -> db: t8 UPDATE ... WHERE note_count < 2
note b: t8 0 rows
step b -> db: t9 COMMIT
note b: the API answers quota_exceeded
```

An Aurora DSQL transaction keeps reading the data as it was when the transaction began (snapshot isolation). B sees `note_count = 1` as of t2, so its `UPDATE` at t4 goes through without complaint. B does not know that A has already written.

On an ordinary PostgreSQL, B would wait at t4 for A's lock to be released. DSQL does not make it wait. It lets both proceed without locks and checks at commit whether another transaction committed the same row first. This is optimistic concurrency control (OCC). B loses at t6 and gets SQLSTATE `40001` (serialization failure). Nothing B wrote remains.

The loser has one thing to do: **run the transaction again from the start.**

<<< @/examples/13-sql/src/transaction.ts{run}

Sending just the `COMMIT` again will not do. Look at t7. The second time, B reads `note_count = 2` and decides there is no room. A different answer from the first time. Had it remembered its earlier decision and replayed only the `INSERT`, there would be a third note.

The invariant for this chapter: **a transaction either commits as a whole or is run again as a whole, and a rerun changes its outcome only through values read from the database again.**

To keep the second half true, the create is written like this.

<<< @/examples/13-sql/src/notes-repository.ts{create}

There are three rules.

**Inside the transaction, touch nothing but the database.** Sending an email or calling another API in there would happen twice, three times, once per rerun.

**Decide the ID and the time outside, and pass them in.** An ID made inside the transaction would be a different note on every rerun.

<<< @/examples/13-sql/src/notes.ts{service}

**If the same ID is already there, do nothing.** That is the `selectNote` at the top. It is needed because the answer to a commit can fail to arrive. When a connection drops, the commit may have succeeded or not. If calling again with the same ID still leaves one note, either case is fine.

### Why update one row instead of counting

With `SELECT count(*) FROM app.notes` followed by `INSERT`, A and B both read "one note" and each inserts a different row. They did not write the same row, so DSQL sees no conflict. Both commit, and there are three notes. This is called write skew.

Always updating `note_count` in `owners` is there to make the two transactions collide on one row, on purpose. Then the database stops one of them.

The price: creates and deletes by the same owner go through one at a time. For one person's notes that is plenty. Design it so that everyone updates the same single row, and you get nothing but reruns. Deciding which row transactions collide on is the center of designing for DSQL.

### How far to retry

<<< @/examples/13-sql/src/transaction.ts{policy}

Only `40001` is retried. At most 4 attempts, with waits that grow and are spread out at random, so that transactions that lost together do not come back together and collide again.

After losing four times, the API gives up with a 503.

<<< @/examples/13-sql/src/app.ts{errors}

Every attempt was rolled back, so nothing was written. The caller can simply send it again.

Reads go through the same runner. Right after a schema change, a connection that still remembers the old schema can receive `40001` (OC001). The cost is an extra `BEGIN` and `COMMIT` round trip per read.

By the way, the `version` check and this retry are separate matters. `version` catches "someone changed it between opening the screen and saving": seconds to minutes. OCC catches "two commits at the same instant": milliseconds. You need both.

## Causing a conflict on purpose

<!-- section: 13.conflicts -->

Awkwardly, this conflict never happens locally. PGlite has a single connection, and transactions run one after another.

So what does not happen gets made to happen.

<<< @/examples/13-sql/test/support.ts{inject}

When `COMMIT` arrives, it rolls back instead of committing, commits the "winner's" writes first, and then throws `40001`. That is what happens when you lose on DSQL, in the same order. The SQL itself runs on a real PostgreSQL (PGlite).

With that, the timeline above becomes a test as it stands.

<<< @/examples/13-sql/test/notes-repository.test.ts{conflicts}

The second test is the heart of the chapter. The loser of the last slot reruns and ends as `quota_exceeded`, and the count in `owners` and the number of rows in `notes` both equal the cap exactly.

To be honest, this does not prove that DSQL behaves this way. It checks that this code does the right thing when DSQL returns `40001` as documented. Causing a conflict on a real cluster is still to be done.
