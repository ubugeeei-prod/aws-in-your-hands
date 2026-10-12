---
title: "05 KV Store: Run It Locally"
---

# 05 KV Store: Run It Locally

This page runs the API from the [Design and Build](/en/chapters/05-dynamodb/build.md) page on your machine, first with the in-memory implementation and then against DynamoDB Local. After that it goes through what the tests check.

## Running it locally

<!-- section: 05.local -->

Copy `examples/05-dynamodb/.env.example` to a file named `.env` in the same place.

<<< @/examples/05-dynamodb/.env.example

The required environment variables depend on where notes are stored, and the schema that validates them expresses that difference.

<<< @/examples/05-dynamodb/src/env.ts{env}

### In memory

Start the API with the default `NOTES_STORE=memory`. You need neither Docker nor AWS.

```bash
vp run dev:notes
```

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"draft"}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"final","body":"","expectedVersion":1}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"stale","body":"","expectedVersion":1}'
curl -s 'http://localhost:8787/notes?limit=1'
```

Replace `<id>` with the `id` from the first response. The second command returns the note with `version` 2, and the third returns a 409 together with the stored note.

The in-memory implementation is enough for checking the shape and the rules of the API. It can't check anything about DynamoDB's own behavior.

### Against DynamoDB Local

DynamoDB Local is a simulation of DynamoDB that AWS distributes, and it runs as a container. It needs a running Docker daemon, and Docker isn't part of the devShell.

```bash
vp run db:local:start
vp run db:migrate:local
vp run db:seed:local
```

`db:migrate:local` creates the table, and `db:seed:local` loads the notes in `test/fixtures/seed-notes.json`. Change `NOTES_STORE` in `.env` to `dynamodb` and start `vp run dev:notes`, and the API uses this table. Run `vp run db:reset:local` to recreate the table, and `vp run db:local:stop` to stop and remove the container.

These tasks refuse to run unless the endpoint is `localhost`, so they can't delete a table in real AWS by mistake.

Local development differs from D1 in two ways. With D1, starting `wrangler dev` gives you a local database, and with DynamoDB you start the simulation yourself. D1 migrations apply SQL files in order, but DynamoDB has no column definitions, and the only thing you decide for a table is its keys. `scripts/local-db.ts` creates the local table, and CDK creates the table on AWS. The two definitions are kept in sync by hand.

Because DynamoDB Local is a simulation, it can confirm only that the expressions are accepted and that they behave as intended on a single machine. It doesn't reproduce IAM, throttling, or the replication and latency of the real service.

Of the tasks in this section, `db:local:start` and `db:local:stop`, which start the container with Docker, haven't been run yet, because a Docker daemon wasn't available at the time of writing. `db:migrate:local`, `db:seed:local`, and `db:reset:local` haven't been run as tasks either. The results of the tests against DynamoDB Local are in the "Tests" section that follows.

## Tests

<!-- section: 05.tests -->

```bash
vp run test:unit
vp run test:local:dynamodb
```

The tests come in five layers, and each layer checks something different.

| Layer | File | What it looks at | What it can't see |
| --- | --- | --- | --- |
| Contract (in memory) | `test/repository-contract.ts`, `test/memory-repository.test.ts` | The rules of the repository: no overwrites, the version, paging, separation between owners, the limit on the count | DynamoDB's behavior |
| Request inspection | `test/dynamodb-repository.test.ts` | The condition expressions, key shapes, and consistency settings sent to DynamoDB. Handling of a failed condition | That DynamoDB behaves as those requests ask |
| Contract (DynamoDB Local) | `test/dynamodb-local.test.ts` | That the same rules hold on the simulation | IAM, throttling, the distributed behavior of the real service |
| App and client | `test/app.test.ts` | 409, paging, rejection of a forged cursor, the cap on the size of a list, a retry after a lost response, refusal of the 101st note | Behavior when the request goes through Lambda and API Gateway |
| Infrastructure | `infra/test/notes-stack.test.ts` | That the permissions are limited to five operations and one table, the table's removal policy, the table's caps, and the stage's throttling | That AWS behaves as the template says |

The contract tests state the rules once and run them for each implementation.

The tests for the DynamoDB implementation hand it a stand-in for the SDK client and inspect the requests it sends. If someone removes `ConditionExpression`, `ConsistentRead`, or the shape of the keys, which carry the guarantees, these tests fail. They confirm only that the right requests are sent. How DynamoDB handles those requests is checked against DynamoDB Local or real AWS.

`test:local:dynamodb` fails when `DYNAMODB_ENDPOINT` is not set. The test file itself skips when there is no endpoint. A skipped test looks like a success at a glance, so the dedicated task turns it into a failure. The `1 skipped` in the output of `vp run test:unit` is this test.

For concurrent writes, the contract tests check that of two writes carrying the same `version`, exactly one goes through. In the in-memory implementation this always holds, because the writes run one after the other inside a single process.

The limit on the count has the same kind of check. It sends six creates at once where there are three places and confirms that exactly three go through.

The place these checks really need to run is the real DynamoDB, and they have never been run there. On DynamoDB Local (3.3.1), the 15 contract tests passed. That DynamoDB Local was started directly from the jar that AWS distributes, not by the Docker task. The simulation runs on one machine, though. So the central claim of this chapter, that "a conditional write lets through exactly as many concurrent writes as it should", is unconfirmed on the real service. The statements about DynamoDB's behavior are based on the official documentation.
