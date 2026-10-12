---
title: "59 RDS: Build, Continued"
---

# 59 RDS: Build, Continued

The [previous page](/en/chapters/59-rds/build.md) placed one instance and connected to it. This page is about what happens with two instances or more. Keeping a standby and sending reads to another instance look alike, and are different things.

## Keeping a standby: the two forms of Multi-AZ

<!-- section: 59.multi-az -->

A Single-AZ instance is one machine in one Availability Zone. If its host or its volume fails, the API is down until RDS has recovered it. If the whole zone is unavailable, it is down for as long as that lasts.

RDS offers two deployments against this. Their names are close, so here they are side by side.

| | Single-AZ | Multi-AZ DB instance | Multi-AZ DB cluster |
| --- | --- | --- | --- |
| Instances | one | a primary and a standby | one writer and two that also serve reads |
| Replication | none | synchronous | semisynchronous: one of the two must confirm a commit |
| Reads from the standby | | no | yes, though they can be behind |
| Failover time (as documented) | | typically 60–120 seconds | typically under 35 seconds |
| Can be stopped | for up to 7 days | for up to 7 days | no |
| Smallest configuration, a month | USD 18.25 | USD 36.50 | USD 239.37 |

The amounts are for the instances only, without storage. A Multi-AZ DB instance costs exactly twice the Single-AZ rate, for the instance and for the storage. A Multi-AZ DB cluster is limited to certain instance classes, and the smallest is db.c6gd.medium.

The standby of a Multi-AZ DB instance is in another zone and is written synchronously with the primary. A write whose commit returned successfully is on the standby too. In exchange, writes and commits can take longer than on Single-AZ. The standby exists for failover alone and cannot be read.

A Multi-AZ DB cluster puts one instance in each of three zones. The name says cluster, but it is not an Aurora cluster. The two readers receive changes through PostgreSQL's own replication. A commit needs the confirmation of only one of them, so a reader can be behind. That lag causes the same problem as the read replica of the next section.

The `production` profile chooses a Multi-AZ DB instance.

### What a failover does to connections

A failover does not happen only when the primary's host or storage fails, when it drops off the network, or when it stops responding. An operating system update does it too, and so does an operation of your own, such as changing the instance class.

In a failover, RDS rewrites the DNS record of the endpoint name to the standby's address. The endpoint name does not change. Seen from the application, this is what happens.

Every open connection becomes useless. The connection pool on the previous page discards a connection after any error that the database did not answer with, so the next request opens a new one, resolves the name again, and reaches the new primary. A client that remembers the DNS answer for long keeps connecting to the old address. The documentation recommends remembering it for less than 30 seconds.

Until the switch is complete, requests fail. This chapter's function gives up on a connection after 5 seconds, and chapter 13's application answers 500.

A transaction that was in flight has an unknown outcome. If the connection drops after `COMMIT` was sent and before the answer arrived, the application cannot know whether it was committed. Chapter 13's create was built so that calling it again with the same ID leaves one note. Only operations of that kind may be sent again. Chapter 60 takes this problem further, with tests that cut the connection midway.

No failover was ever caused in this chapter. The 60–120 seconds are the documentation's words, and the documentation itself recommends testing a failover on your own setup and timing it.

## A read replica is behind

<!-- section: 59.replica -->

A read replica is another, read-only instance that keeps receiving the primary's changes. Its purpose is to take heavy reports and lists off the primary. One primary can have up to 15 of them in the same Region. Each replica has an endpoint of its own.

What separates it from a standby is that its replication is **asynchronous**. The primary returns from a commit without waiting to hear that the replica has it. The replica holds data that is a little older than the primary's. How much older is not fixed, and it grows when writes pile up on the primary or a heavy query runs on the replica. This delay is called replica lag.

Point the notes application's reads at a replica, and this happens:

```figure
caption: The write is committed on the primary and has not reached the replica yet. Its author loses sight of the note right after writing it
type: sequence
actor client: Client
actor primary: Primary
actor replica: Read replica
step client -> primary: t1 POST /notes
note primary: t2 COMMIT
step primary --> client: t3 201 Created
step client -> replica: t4 GET /notes/{id}
step replica --x client: t5 404 Not Found
step primary --> replica: t6 the change arrives
note replica: t7 replayed
step client -> replica: t8 GET /notes/{id}
step replica --> client: t9 200 OK
```

The 404 at t5 is not a failure. The primary and the replica are both healthy, and each answers correctly. And still a note that was saved appears to have vanished.

This chapter's invariant is: **whoever wrote something sees that write in every read they make afterwards.** The property is known as read-your-writes.

### Reproducing the lag locally

There is no RDS read replica on a laptop. So the lag alone was lifted out into a model.

<<< @/examples/59-rds/src/model/replication.ts{model}

The model starts two PGlite databases and treats one as the primary and the other as the replica. It remembers, in order, the statements of every transaction committed on the primary, and sends them to the replica in the same order only when `replay` is called. If nobody calls it, the replica stays old for ever.

The model matches the real thing in two respects. On both sides the SQL is executed by a real PostgreSQL. And the replica refuses writes with SQLSTATE `25006`. Where it differs matters more. PostgreSQL replication ships the bytes of the write-ahead log; this model carries the text of statements. It has no network, no conflicts with queries on the replica, and no reconnects. It can show one thing only: whether the application's code behaves correctly while the replica is behind.

First, a test shows the invariant being broken.

<<< @/examples/59-rds/test/routing.test.ts{stale}

The first test is t5 of the figure. The second is how things look once the next section's remedy is in place.

### A replica is no substitute for a standby

A read replica becomes an instance of its own when you promote it by hand. That looks like a way out when the primary is lost, but any write that had not reached the replica at the moment of promotion is gone.

<<< @/examples/59-rds/test/routing.test.ts{promote}

What is lost is a write the primary had reported as successful. With the synchronously written standby of Multi-AZ this does not happen. Think of the two roles separately: Multi-AZ is for failures, a read replica is for taking reads. A promotion also cannot be undone.

Read replicas come with further conditions. One cannot be created unless automated backups are enabled on the source. Neither an instance that has a replica nor the replica itself can be stopped. There is no point-in-time recovery for a replica. And, as the previous page said, an instance whose master password RDS manages cannot have one.

## Reading your own writes

<!-- section: 59.read-your-writes -->

The remedy is simple in outline. Whoever writes remembers a position, "I have seen the primary up to here", and before a read checks whether the replica has caught up to it. If it has, the replica answers; if not, the primary does.

### Positions

PostgreSQL writes every change, in order, to the write-ahead log. A position in it is an LSN (log sequence number).

<<< @/examples/59-rds/src/lsn.ts{lsn}

An LSN is printed as two hexadecimal numbers, like `16/B374D848`. Compared as text, `9/0` would come after `10/0`, so positions are turned into numbers first.

How far the primary has written comes from `pg_current_wal_lsn()`, and how far a replica has replayed from `pg_last_wal_replay_lsn()`.

<<< @/examples/59-rds/src/position.ts{position}

Each function has its proper addressee. `pg_current_wal_lsn()` cannot be executed on a replica, and `pg_last_wal_replay_lsn()` returns NULL on anything that is not one. With the endpoints mixed up, the first raises an error and the second means "position unknown".

### Deciding where a read goes

<<< @/examples/59-rds/src/routing.ts{choose}

The rule is these few lines. If the replica's position is unknown, the primary. If the session has seen nothing, the replica. If it has, the replica only when it has caught up that far.

The following part remembers the position and keeps it current.

<<< @/examples/59-rds/src/routing.ts{session}

After a write, the primary's position is remembered. It is asked for after the commit has finished, so the answer is the commit's own position or a later one. Remembering a position that is a little too late only means a few more reads from the primary; the invariant holds.

A write is not the only moment a position is remembered. After a read that the primary answered, its position is remembered too. Without that, a read can go back in time.

<<< @/examples/59-rds/test/routing.test.ts{monotonic}

In this test, someone else adds a note to the same list after your own write. The list read from the primary has two entries. Then the replica catches up, but only as far as your write. If only write positions were remembered, the replica would now qualify, and the next list would shrink to one entry: a note you have just seen disappears. With the read position remembered as well, the primary keeps answering until the replica reaches it.

When a position is unknown, everything falls to the primary. If the replica does not report its position, the primary is read. If the primary's position could not be asked for after a write, the session remembers a position no replica will ever reach (`LSN_MAX`), which pins it to the primary.

### The client carries the position

The position is not remembered on the server. The Lambda execution environment may differ from request to request, and a value in memory is invisible to the next one. The position is handed to the client in a response header and comes back in a header of the next request.

<<< @/examples/59-rds/src/app.ts{app}

The application itself is chapter 13's `createApp`. All this chapter adds is one session per request and a repository, given to chapter 13's service, that decides where to go. The answer of `/health` is replaced on this chapter's side, because chapter 13's settings know only two kinds of database.

The header's value comes from the client, from outside the types. A value that cannot be read as a position sends the read to the primary. A client that keeps sending a huge position gets all its reads from the primary. It gives up the replica's benefit for itself and sees nobody else's data.

If you have used D1, this will look familiar. The D1 Sessions API mentioned in chapter 13 guarantees that reads within a session do not go backwards by carrying a bookmark from request to request. What was built here is that bookmark, implemented by hand. What the platform does for you on D1, you write yourself on RDS.

The whole behaviour through the API is in this test.

<<< @/examples/59-rds/test/app.test.ts{http}

### What this remedy does not guarantee

It protects only a session that holds a position. The same person's screen on another device holds none and may show an old list. Nor does it say when anyone else's write becomes visible.

It is not free in cost or load either. Every read adds one query that asks the replica for its position. Every write adds one that asks the primary. And while the replica is behind, reads come back to the primary, so the primary needs enough headroom to take all of them without falling over. Adding a replica does not necessarily allow a smaller primary.

There is a simpler way: for a few seconds after a write, send that person's reads to the primary. It needs no query for a position, but "a few seconds" is a guess, and the invariant breaks the moment the lag exceeds it.

Deployed with `-c readReplica=true`, the stack adds one replica and gives the function a second endpoint. This configuration was not run on a real RDS. That a replica reports its position as a value comparable with the primary's was only read from the documentation of the two functions.
