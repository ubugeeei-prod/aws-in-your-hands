---
title: "13 SQL: Run It Locally"
---

# 13 SQL: Run It Locally

## Running it locally

<!-- section: 13.local -->

Copy `examples/13-sql/.env.example` to `.env` in the same directory.

<<< @/examples/13-sql/.env.example

```bash
vp run sql:db:migrate:local
vp run sql:db:seed:local
vp run dev:sql
```

The API comes up at <http://localhost:8787>.

```bash
curl -s http://localhost:8787/notes
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"edited","expectedVersion":1}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"stale","expectedVersion":1}'
```

Replace `<id>` with the `id` in the create response. The last call is an update from an old `version`. It answers 409 with `code` `conflict` and the note as it is now.

To start over:

```bash
vp run sql:db:reset:local
```

It deletes the database directory and runs the migrations and the seed again.

### What the local database really is

No Docker. It is PGlite, an npm package that runs PostgreSQL, compiled to WebAssembly, inside the Node.js process. The data lives in `examples/13-sql/.pglite/`.

<<< @/examples/13-sql/src/pglite.ts{pglite}

It is probably the closest thing to `wrangler dev` handing you a local D1. But where D1's local mode runs the same D1 as production, this is a **stand-in**. It is not Aurora DSQL. Here is what it does not reproduce.

- **Conflicts.** One connection, so `40001` never occurs. See the previous section
- **Authentication.** No tokens, no IAM, no database roles. Being refused for lack of permission does not happen locally
- **DSQL's limits.** 3,000 rows, 5 minutes, one DDL statement, mandatory `ASYNC`. PGlite cares about none of them. The lint watches some in its place
- **Version.** When run here, PGlite 0.5.8 reported PostgreSQL 18.3. DSQL is compatible with PostgreSQL 16. SQL that exists only in the newer version passes locally and nowhere else
- **The network.** No connection setup, no drops, no latency

One more finding from trying it. PGlite does not stop two processes from opening the same directory. Left alone that corrupts it, so a lock file does the refusing. Run `sql:db:reset:local` while `dev:sql` is up and it tells you to stop the dev server first, and exits.

And `dev:sql` does not run migrations for you. If some are not applied, it names them and stops. Same manners as `wrangler dev`.

<<< @/examples/13-sql/src/dev.ts{dev}

Set `NOTES_DB` to `dsql` in `.env` and the same dev server connects to a deployed cluster with your own credentials. That is billed, and it has not actually been tried yet.
