---
title: "13 SQL: Design and Build"
---

# 13 SQL: Design and Build

The [previous page](/en/chapters/13-sql.md) showed the setup and where Aurora DSQL differs from PostgreSQL. This page implements the schema, the queries, and the transactions within those constraints.

## Schema and migrations

<!-- section: 13.migrations -->

There are two tables.

<<< @/examples/13-sql/migrations/0002_create_owners.sql

<<< @/examples/13-sql/migrations/0003_create_notes.sql

A note's ID is a random UUID that the application generates. On D1 you would often use an `INTEGER PRIMARY KEY` counter, but the DSQL documentation advises against monotonically increasing primary keys on tables with many writes, because every new row lands in the same place.

`note_count` in `owners` keeps a count so that one owner can hold at most 100 notes, and it becomes central in the section "A transaction is retried as a whole" below. As in chapter 04, a list returns only summaries of the newest 20 notes, and there is no pagination.

There is one index.

<<< @/examples/13-sql/migrations/0004_index_notes_by_owner.sql

### One statement per file

A D1 migration file can hold any number of SQL statements, but in this chapter a file holds exactly one.

DSQL allows only one DDL statement per transaction, so a file with several statements cannot be made to apply completely or not at all. With one statement per file from the start, each file corresponds to exactly one transaction.

This is the runner.

<<< @/examples/13-sql/src/migrate.ts{migrate}

Like D1, it runs the files in name order and records how far it got in a table (`public.aih_migrations`). The difference is the part that the comments inside the loop explain.

DDL and DML cannot share a transaction, so the schema change and the record of that change happen in separate transactions. If the process dies after the change and before the record is written, the migration is applied but not recorded.

The next run then sends the same statement again. For that reason every statement is written in a form that is safe to run twice (`IF NOT EXISTS`), and the [lint on the previous page](/en/chapters/13-sql.md) enforces it. The invariant for migrations is this: **if there is a record, the statement has been applied, and a statement without a record gives the same result when it is run again.**

A test that stops the runner just before it writes the record checks this invariant.

<<< @/examples/13-sql/test/migrate.test.ts{interrupted}

If you edit a file after it was applied, the runner notices that the checksum changed and stops. To fix something, add a file with a new number.

The local PostgreSQL does not accept the word `ASYNC`, so the runner removes it just before sending the statement, and only when it sends to the local database.

<<< @/examples/13-sql/src/migrate.ts{dialect}

The files contain DSQL's SQL, and the local side adapts to it. It is not the other way around.

## Rows into types

<!-- section: 13.queries -->

The API contract is nearly the one from chapter 04, with updates (`PUT`) and a `version` added.

<<< @/examples/13-sql/src/contract.ts{note}

One thin interface sits between the application and the database.

<<< @/examples/13-sql/src/db.ts{db}

`query` takes SQL text and numbered values such as `$1`. This chapter's application never puts a value into the SQL text, so that there is no opening for SQL injection to begin with.

The `rows` that `query` returns are typed `unknown[]`. node-postgres lets you attach any type you like to a row, but that type is only a declaration of the shape you expect. If a migration renames a column, the type stays the same and only the runtime value changes.

A database row comes from outside the type system, as an HTTP request does, so it is checked against a schema at the boundary in the same way.

<<< @/examples/13-sql/src/db.ts{rows}

<<< @/examples/13-sql/src/notes-repository.ts{row}

The row schema also converts the snake_case columns into the API's `Note`. Both node-postgres and PGlite return `timestamptz` as a `Date`, which the schema turns into an ISO 8601 string.

A list is read in a different shape from a single note.

<<< @/examples/13-sql/src/notes-repository.ts{list}

The `SELECT` has no `body` column. SQL lets you choose the columns you get back, so a list takes only the ID, the title, `version`, and the two timestamps. The value passed to `LIMIT` is 20. An owner can hold up to 100 notes, but a list returns at most the newest 20, so that one response stays within 20 KiB as in chapter 04. `GET /notes/:id` returns the body by reading that one row.

This is the update.

<<< @/examples/13-sql/src/notes-repository.ts{update}

The key part is `WHERE ... AND version = $6`. If the `version` is still the one you loaded, the statement updates the row and advances `version` by one. If it is not, no row is updated, and the code reads the current row and returns it with a 409. The check and the write are a single statement, so no other write can come between them.

You can write the same SQL on D1.

## A transaction is retried as a whole

<!-- section: 13.transactions -->

Transactions are where this chapter differs most from D1.

Creating a note first checks that the owner has not yet reached 100 notes. The obvious way to write that is to count the notes and `INSERT` if there is room. The figure follows two such requests that run at the same time, with a limit of 2 and one note already present.

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

An Aurora DSQL transaction keeps reading the data as it was when the transaction began (snapshot isolation). B sees `note_count = 1` as of t2 and does not know that A has already written, so its `UPDATE` at t4 goes through.

On an ordinary PostgreSQL, B would wait at t4 for A to release its lock. DSQL does not make B wait. It lets both transactions proceed without locks, and at commit it checks whether another transaction has already committed a change to the same row. This is called optimistic concurrency control (OCC). B loses at t6 and receives SQLSTATE `40001` (serialization failure), and nothing B wrote remains.

The loser **runs the transaction again from the start.**

<<< @/examples/13-sql/src/transaction.ts{run}

Sending only the `COMMIT` again is not enough. At t7 in the figure, the rerun of B reads `note_count = 2` and now decides there is no room. The answer differs from the first attempt, so if B remembered its earlier decision and replayed only the `INSERT`, a third note would exist.

The invariant for this chapter is this: **a transaction either commits as a whole or is run again as a whole, and a rerun changes its outcome only through values it reads from the database again.**

To keep the second half true, the create operation is written as follows.

<<< @/examples/13-sql/src/notes-repository.ts{create}

The operation follows three rules.

The first is to touch nothing but the database inside the transaction. Sending an email or calling another API there would run two or three times, once for each rerun.

The second is to decide the ID and the time outside and pass them in. An ID generated inside the transaction would be a different note on every rerun.

<<< @/examples/13-sql/src/notes.ts{service}

The third is to do nothing if a row with the same ID already exists, which is what the `selectNote` at the top does. The response to a commit can fail to arrive, and when a connection drops you cannot tell whether the commit succeeded. If calling again with the same ID still leaves exactly one note, the result is the same in both cases.

### Why the code updates one row and does not count

With `SELECT count(*) FROM app.notes` followed by `INSERT`, A and B both read "one note" and each inserts a different row. They did not write to the same row, so DSQL sees no conflict. Both commit, and there are three notes. This is called write skew.

The code always updates `note_count` in `owners` so that the two transactions collide on the same row on purpose. When both write the same row, the database stops one of them.

In exchange, only one create or delete by the same owner goes through at a time. That is enough for one person's notes, but a design in which everyone updates the same single row would spend most of its time on reruns. Deciding which row transactions collide on is the center of designing for DSQL.

### What is retried, and how often

<<< @/examples/13-sql/src/transaction.ts{policy}

Only `40001` is retried, and there are at most 4 attempts. The wait grows with each attempt and is randomized, so that transactions that lost together do not return together and collide again.

After losing all four attempts, the API gives up and returns a 503.

<<< @/examples/13-sql/src/app.ts{errors}

Every attempt was rolled back, so nothing was written. The caller can send the same request again as it is.

Reads go through the same runner, because right after a schema change a connection that still remembers the old schema can receive `40001` (OC001). The cost is one more `BEGIN` and `COMMIT` round trip for each read.

The `version` check and this retry catch different things. `version` catches someone else changing the note in the seconds or minutes between opening the screen and saving. OCC catches two commits that arrive within milliseconds of each other. You need both.

## Causing a conflict on purpose

<!-- section: 13.conflicts -->

This conflict does not happen locally. PGlite has a single connection and runs transactions one at a time, in order.

The tests therefore create the conflict themselves.

<<< @/examples/13-sql/test/support.ts{inject}

When `COMMIT` arrives, the wrapper rolls back instead of committing, commits the winner's writes first, and then throws `40001`. This reproduces what happens when a transaction loses on DSQL, in the same order. The SQL itself runs on a real PostgreSQL (PGlite).

With this in place, the timeline in the figure above can be written as a test directly.

<<< @/examples/13-sql/test/notes-repository.test.ts{conflicts}

The second test is the center of this chapter. The side that loses the race for the last slot reruns and ends with `quota_exceeded`, and the count in `owners` and the number of rows in `notes` both equal the limit exactly.

This test does not prove that DSQL really behaves this way. It checks that this code works correctly when DSQL returns `40001` as its documentation says. Causing a conflict on a real cluster and checking it there has not been done yet.
