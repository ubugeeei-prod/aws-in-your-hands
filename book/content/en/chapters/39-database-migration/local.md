---
title: "39 Database Migration: Run It Locally"
---

# 39 Database Migration: Run It Locally

This page checks the cutover procedure from the [previous page](/en/chapters/39-database-migration/build.md) on your own machine, without connecting to AWS. It needs no credentials and costs nothing. What runs locally, though, is not DMS.

## This chapter's model

<!-- section: 39.local -->

There is no way to run DMS locally. In its place is a model: the behaviour the documentation describes, written as a small amount of code. The model was written for this chapter and has nothing to do with the DMS implementation. A test that passes on the model is not evidence that DMS behaves that way. What it can show is why the documented rules exist, and whether this chapter's procedure and scripts work correctly under those rules.

The databases are two instances of PGlite, the same one chapter 13 uses, standing as source and target inside one process. PGlite is PostgreSQL itself, so foreign keys, sequences, `session_replication_role`, and read-only transactions behave as the real thing.

Change capture is not the real thing. PGlite runs with `wal_level` set to `replica`, and an attempt to create a logical replication slot is refused with SQLSTATE 55000. So row triggers write the changes to a table.

<<< @/examples/39-database-migration/src/model/capture.ts{install}

On a table with a primary key the trigger records the primary key of the row before the change, and on a table without one it records nothing. That is the same amount of information as PostgreSQL's default replica identity gives. The volume of WAL, a slot filling the disk, and transaction boundaries are not in this model.

The full load reads each table whole and writes it, one table at a time.

<<< @/examples/39-database-migration/src/model/replicate.ts{full-load}

Capturing a table's changes begins just before that table is read. This follows the documentation's statement that DMS does not capture changes for a table until the full load for that table has started. A change made between the start of capture and the read is in both the copy and the change log. The tests insert writes at fixed positions with two hooks, `beforeRead` and `afterRead`.

<<< @/examples/39-database-migration/src/model/replicate.ts{apply-one}

Applying a change follows DMS's default error handling. An `INSERT` of a row that is already there is counted and passed over, and an `UPDATE` or `DELETE` on a table without a primary key is ignored, because there is nothing to find the row by.

<<< @/examples/39-database-migration/src/model/replicate.ts{apply}

The record of how far changes were applied (the checkpoint) advances every fixed number of changes. With `crashAfter`, the tests produce the state in which changes were applied and the process stopped before recording it.

## Tests

```bash
vp run test:unit
```

This runs the tests of the whole repository. For this chapter alone, use `vp test run examples/39-database-migration`.

The tests look at the things that hurt in a real migration.

- A row changed and a row deleted while their table was being copied. The copy alone is stale, and matches the source only once the changes are applied
- A change that is in both the copy and the log. The `INSERT` is rejected as a duplicate and the `DELETE` finds no row, and the end state still matches
- Double application on resume. Stopped right after applying five changes, with the checkpoint not advanced, a resume ends in the same result
- A table without a primary key. The same resume adds rows (5 on the target for 3 on the source), and `UPDATE` and `DELETE` are not carried
- Foreign keys. A child table can be copied before its parent while `session_replication_role = replica` is set, and once it is set back the same `INSERT` is refused with 23503
- Sequences. With every table matching, the first `INSERT` on the target collides with 23505. After they are advanced, numbering continues where the source left off, and the number of a deleted row is not handed out again
- What the comparison sees and does not see. It finds a truncated body. It does not find a missing index or constraint. While writes continue it reports changes that have only not arrived yet as mismatches
- The two accidents after the switch: a late write to the source, and an overwrite by a resumed replication
- The table mappings, the preflight check, the cutover decisions, and the stack assertions

## The whole run

```bash
vp run dbmig:demo
```

It runs everything from preparation to the switch on two PGlite instances and prints each step. This is the output from a run on 2026-10-13.

```text
1. preflight, on the source as found
   blocker public.owners: lob-primary-key
   note    public.notes: lob-column
   note    public.note_revisions: lob-column
   note    public.note_revisions: sequence
   blocker public.audit_log: no-primary-key
   note    public.audit_log: lob-column
2. sql/source/0002_prepare.sql, then preflight again
   blockers: 0
3. full load, while the application keeps writing (model, not AWS DMS)
   app.owners         source 1  target 1  match
   app.notes          source 1  target 2  DIFFER
   app.note_revisions source 2  target 2  match
   app.audit_log      source 1  target 1  match
   changes not applied yet: 2
4. apply the recorded changes
   applied 2, insert conflicts 0, missing rows 0
5. stop writes on the source, then compare
   a late write to the source: SQLSTATE 25006
   app.owners         source 1  target 1  match
   app.notes          source 1  target 1  match
   app.note_revisions source 2  target 2  match
   app.audit_log      source 1  target 1  match
6. the first insert on the target, before and after the sequences are advanced
   before: SQLSTATE 23505
   app.note_revisions_id_seq: source handed out 2, target holds 2, set to 2
   app.audit_log_id_seq: source handed out 1, target holds 1, set to 1
7. may we switch?
   yes
   after:  id 3
```

At step 3 the target's `app.notes` has two rows and the source has one, because one row was updated and one deleted on the source during the copy. Applying the changes in step 4 makes them match. In step 6 everything matches and the first `INSERT` still fails, and after the sequences are advanced the same `INSERT` receives number 3.

## What cannot be checked locally

These are not in the local model: DMS's type mapping and LOB handling, data validation and premigration assessments, slots and WAL, the network and IAM, the latency metrics, Serverless capacity scaling, and how long anything takes. How many hours the full load needs and how many minutes the cutover's outage lasts cannot be known without running DMS on data of the same size.

Next is [Deploy](/en/chapters/39-database-migration/deploy.md).
