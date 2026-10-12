---
title: "66 Distributed SQL: Run It Locally"
---

# 66 Distributed SQL: Run It Locally

The [previous page](/en/chapters/66-distributed-sql/build.md) went through the implementation. This page runs what can be checked without creating anything in AWS, lightest first. At the end a three-node cluster runs on a Mac and nodes are killed. No credentials are needed and AWS bills nothing.

## What can be checked without the binary

<!-- section: 66.local-tests -->

These four work without downloading YugabyteDB.

```bash
vp test run examples/66-distributed-sql
vp run distsql:render
vp run distsql:infra:synth
vp run distsql:infra:synth -c nodes=3
```

The tests look at the flag files produced from the cluster definition, failover between nodes, the model of the majority, what chapter 13's retry loop does when handed YugabyteDB's errors, the files a node gets, the price arithmetic, and the content of the stack.

What these tests do not look at should be just as clear. The repository tests use PGlite, which has one session and never a real conflict. The YugabyteDB errors are copies of what the local cluster answered, injected. The majority tests run this chapter's model, not a database. How the real thing behaved is what the rest of this page checks.

## Fetch the binary

<!-- section: 66.local-fetch -->

```bash
vp run distsql:fetch
```

This task downloads the archive of the pinned version from the vendor's host (`software.yugabyte.com`) and unpacks it into `examples/66-distributed-sql/.yugabyte/` only when its size and SHA-256 match the values in `src/yugabyte.ts`. That directory is not in git. Nothing is started.

<<< @/examples/66-distributed-sql/scripts/fetch.ts{verify}

The archive is 130 MB and unpacks to about 410 MB. Apple silicon macOS and arm64 Linux are covered. No package was added to the Nix flake, so the environment of the other chapters is unaffected.

YugabyteDB's documentation recommends `yugabyted` for running it locally. `yugabyted` needs Python 3.11 and the Nix shell has no Python, so this chapter does not use it. It starts `yb-master` and `yb-tserver` directly instead. On EC2 the same two are started directly, so the way of starting is the same locally and in production.

## Start three nodes

<!-- section: 66.local-cluster -->

```bash
vp run distsql:local:start
vp run distsql:local:status
```

`start` launches `yb-master` and `yb-tserver` for three nodes as detached processes. They listen on `127.0.0.1` only, on ports between 23001 and 29103. The first start takes a while before SQL is accepted. The verification for this chapter waited 40 to 50 seconds before going on.

<<< @/examples/66-distributed-sql/scripts/local-nodes.ts{start}

The flag files used here come from the same functions as those for EC2. Open `.yugabyte/run/node-a/tserver.conf` to read one.

One caution. `yb-tserver` starts PostgreSQL inside itself, and PostgreSQL uses System V shared memory. Inside a sandbox that does not allow shared memory, `initdb` failed and `yb-tserver` exited. In an ordinary terminal this does not happen.

A cluster with TLS can be made as well. The certificates are made with `openssl`, which the devShell (Nix) provides at version 3.5.8.

```bash
vp run distsql:local:destroy
vp run distsql:local:certs
vp run distsql:local:start --tls
```

Whether a cluster uses TLS is decided when it is created. It cannot be switched later, which is why `destroy` comes first.

## Kill nodes and look

<!-- section: 66.local-verify -->

```bash
vp run distsql:local:verify
```

This task puts the chapter's claims to the running cluster one after another. Along the way it kills node processes with SIGKILL and starts them again. This is the output of a run against a cluster without TLS (2026-10-13, macOS 26.6, Apple silicon).

```text
-- chapter 13's migrations and repository, unchanged
    PostgreSQL 15.12-YB-2025.2.7.0-b0 on aarch64-apple-darwin24.6.0, compiled by Apple clang version 17.0.0 (clang-1700.6.4.2), 64-bit
ok    three tablet servers, one per zone
    applied now: 4 of 4
ok    create
ok    create again with the same id leaves one note
ok    update moves the version from 1 to 2
ok    an update from a stale version is a conflict, not a write

-- a quota of 3, and 12 creates at once through three nodes
    created 3, quota_exceeded 9, gave up after 4 attempts 0, retries after SQLSTATE 40001: 4
ok    the quota held: note_count and the rows agree, and neither passed 3  (note_count 3, rows 3)
ok    every acknowledged create is stored
ok    at least one transaction lost a commit and was retried

-- one node lost
node b: yb-tserver (pid 67615) got SIGKILL
node b: yb-master (pid 67612) got SIGKILL
    20 more creates took 948 ms; errors that were retried with the same id: 0; connections refused by the dead node: 1
ok    node a serves all 40 acknowledged notes with b down
ok    node c serves all 40 acknowledged notes with b down
node b: yb-master started, pid 70699
node b: yb-tserver started, pid 70700
    node b accepted SQL again after 2155 ms
ok    node b, back, answers with the notes written while it was down
    the masters reported no dead node and no under-replicated tablet after 26 ms

-- two nodes lost
node b: yb-tserver (pid 70700) got SIGKILL
node b: yb-master (pid 70699) got SIGKILL
node c: yb-tserver (pid 67616) got SIGKILL
node c: yb-master (pid 67613) got SIGKILL
    a create through the one node left: error: No node accepted a connection: 127.0.0.1:25431 (timeout expired)
ok    one node of three does not acknowledge a write
node b: yb-master started, pid 72197
node b: yb-tserver started, pid 72198
node c: yb-master started, pid 72199
node c: yb-tserver started, pid 72200
ok    with the majority back, every acknowledged note is still there  (40 acknowledged, 40 stored)
    the create that was never acknowledged is not stored

-- a logical backup, restored into a second database
ok    the restored copy holds every acknowledged note  (40 rows of this owner)

all checks passed
```

The first block confirms that chapter 13's code runs as it is. The four migration files were applied with the `postgres` dialect, as for PGlite. Dropping `ASYNC` from `CREATE INDEX ASYNC`, which only Aurora DSQL has, is something chapter 13's runner already does.

<<< @/examples/66-distributed-sql/scripts/verify.ts{same-code}

The second block is the conflict. With the quota set to 3 notes, twelve creates by one owner go to three nodes at once. Chapter 13's repository updates `note_count` on the owner's row at every create, so simultaneous creates always collide on the same row.

<<< @/examples/66-distributed-sql/scripts/verify.ts{conflict}

Three were created, and `note_count` and the actual number of rows agreed at 3. Meanwhile four transactions received `40001` and started over. The number differs from run to run: between 4 and 29 over seven runs. No transaction gave up after four attempts in any run.

The third block kills node b. Both `yb-tserver` and `yb-master` get SIGKILL, so the node has no chance to tidy up.

<<< @/examples/66-distributed-sql/scripts/verify.ts{one-node}

After the 20 creates acknowledged before the kill, 20 more follow. In this run they took 948 ms and not one error reached the caller. One connection to the dead node was refused, and the client moved to the next node. In other runs the same 20 took 4.3 seconds. That is presumably the wait for new leaders on the tablets whose leader had been on the killed node, but the time was not broken down.

Nodes a and c each returned, alone, all 40 acknowledged notes. Started again, b accepted SQL after about two seconds, and a connection to b returned the 40 as well. Every node answers by asking the tablet leaders, though, so this result alone does not show that b's own copies caught up. The `/api/v1/health-check` of `yb-master` said there was no dead node and no tablet short of a copy. Whether that answer had changed to "short" during the few seconds b was down was not looked at.

The fourth block kills two nodes, b and c.

<<< @/examples/66-distributed-sql/scripts/verify.ts{two-nodes}

The one node left did not acknowledge a write. In this run it timed out while connecting. In another, the connection was made and no answer came in 20 seconds. It does not answer wrongly; it does not answer. With the two started again, all 40 acknowledged notes were still there.

The one write that was not acknowledged was absent in this run. In three of the seven runs it was there after the nodes came back. A client can assume nothing about a write whose answer it did not receive. This is where chapter 13's design, in which resending with the same ID leaves one note, earns its keep.

The last block is a backup.

<<< @/examples/66-distributed-sql/scripts/verify.ts{dump}

`ysql_dump` writes the whole database to an SQL file, `ysqlsh` feeds it into a new database, and the acknowledged notes are checked to be there. This block retries. In one of the runs with TLS, the `CREATE DATABASE` right after the two nodes were started again failed with `current transaction is expired or aborted`. Right after a majority returns there is a time when things have not settled. The dump only reads and each attempt restores into a new database, so repeating this block is safe.

The same verification ran against a cluster with TLS. Two things differ: a client that does not use TLS is refused, and `yb-admin` cannot find the leader without `--certs_dir_name`.

When you are done, stop the cluster and delete it.

```bash
vp run distsql:local:destroy
```

`.yugabyte/run/` is gone, and `vp run distsql:local:status` confirms that no process is left. The downloaded archive and the binaries (about 540 MB) stay in `.yugabyte/`. Delete the directory when you no longer need them.

Some things cannot be checked locally. The three processes run on one machine with one clock, so there is no clock skew. The network between the nodes is loopback, with no latency and no one-way failure. There is one disk, which cannot fail per node. The Linux binary was never run.
