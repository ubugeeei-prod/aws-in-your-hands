---
title: "59 RDS: Run It Locally"
---

# 59 RDS: Run It Locally

This page runs the primary and the lagging replica of the [previous page](/en/chapters/59-rds/more.md) on your machine, without AWS. It needs no credentials and costs nothing.

## Watching a lagging replica locally

<!-- section: 59.local -->

```bash
vp run dev:rds
```

The API starts on <http://localhost:8787>. Behind it is the previous page's model: two PGlite databases, a primary and a replica. The replica hears of each commit on the primary five seconds late. The databases are in memory and start empty every time, so chapter 13's migrations are applied automatically at startup.

<<< @/examples/59-rds/src/dev.ts{dev}

Create a note and look at the response headers.

```bash
curl -si -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
```

The response carries a header such as `x-notes-seen: 0/173C858`. Its value is the position the primary had written up to at that moment. Before five seconds have passed, read the same note in two ways. Replace `<id>` with the `id` from the create response and `<seen>` with the header's value.

```bash
curl -si http://localhost:8787/notes/<id>
curl -si http://localhost:8787/notes/<id> -H 'x-notes-seen: <seen>'
```

The first answers 404 with `x-notes-read-from: replica`. No position was sent, so the replica answered, and the replica does not know the note yet. The second answers 200 with `x-notes-read-from: primary`. Wait five seconds and send the first again: now the replica answers 200.

The length of the lag can be changed by copying `examples/59-rds/.env.example` to `.env`.

<<< @/examples/59-rds/.env.example

The tests run with `vp run test:unit`, as in the other chapters.

### What is not reproduced locally

PGlite is a stand-in, not RDS. Besides the points listed in chapter 13 (one connection, no authentication, no network), this chapter lacks the following on a laptop.

- Replication itself. The model replays statements; it ships no write-ahead log. Neither the size of a real lag nor what makes it grow can be learned locally
- IAM tokens and TLS. `rds_iam`, `rds.force_ssl`, and the verification of the certificate authority all belong to RDS
- The connection limit. PGlite has one connection, so `too many connections` never happens
- Failover. No connection drops, and no name starts pointing somewhere else
- Parameter groups, backups, maintenance. Everything around the instance is on the RDS side

The versions are close. When run here, PGlite 0.5.8 reported PostgreSQL 18.3, and the stack's default is 18.3 too. Whether RDS still offers that version to new instances is taken up on the next page.
