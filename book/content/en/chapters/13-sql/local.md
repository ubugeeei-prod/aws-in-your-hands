---
title: "13 SQL: Run It Locally"
---

# 13 SQL: Run It Locally

This page runs the API built on the [previous page](/en/chapters/13-sql/build.md) on your own machine, without connecting to AWS. It needs no credentials and costs nothing.

## Running it locally

<!-- section: 13.local -->

Copy `examples/13-sql/.env.example` to `.env` in the same directory.

<<< @/examples/13-sql/.env.example

```bash
vp run sql:db:migrate:local
vp run sql:db:seed:local
vp run dev:sql
```

The API starts at <http://localhost:8787>.

```bash
curl -s http://localhost:8787/notes
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"edited","expectedVersion":1}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"stale","expectedVersion":1}'
```

Replace `<id>` with the `id` from the create response. The last `curl` is an update with an old `version`, so it returns a 409 with `code` set to `conflict`, along with the note as it is now.

To return the database to its initial state, use this task.

```bash
vp run sql:db:reset:local
```

The task deletes the database directory and runs the migrations and the seed again.

### The local database

Docker is not used. The database is PGlite, an npm package that compiles PostgreSQL to WebAssembly and runs it inside the Node.js process. The data is stored in `examples/13-sql/.pglite/`.

<<< @/examples/13-sql/src/pglite.ts{pglite}

It feels close to `wrangler dev` providing a local D1, but D1's local mode runs the same D1 as production, while PGlite is a **stand-in** and is not Aurora DSQL. The following are not reproduced locally.

- Conflicts. There is one connection, so `40001` never occurs. ["Causing a conflict on purpose" on the previous page](/en/chapters/13-sql/build.md) explains why the tests cause it deliberately
- Authentication. There are no tokens, no IAM, and no database roles, so a request is never refused locally for lack of permission
- DSQL's constraints. PGlite ignores the 3,000-row limit, the 5-minute limit, the one-DDL-statement rule, and the `ASYNC` requirement. The lint checks some of them in its place
- The version. When run here, PGlite 0.5.8 reported itself as PostgreSQL 18.3. DSQL is compatible with PostgreSQL 16, so SQL that exists only in the newer version passes locally and nowhere else
- The network. There is no connection setup, no dropped connection, and no latency

Trying it locally also turned up one thing. PGlite does not stop two processes from opening the same directory. That would corrupt the data, so this chapter's code uses a lock file to stop the second process. If you run `sql:db:reset:local` while `dev:sql` is running, it prints a message asking you to stop the dev server and exits.

`dev:sql` does not run migrations automatically. If some have not been applied, it prints their names and stops, which is the same policy as `wrangler dev`.

<<< @/examples/13-sql/src/dev.ts{dev}

If you set `NOTES_DB` to `dsql` in `.env`, the same dev server connects to a deployed cluster with your own credentials. Using it this way is billed, and it has not actually been tried yet.
