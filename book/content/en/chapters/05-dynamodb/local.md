---
title: "05 KV Store: Run It Locally"
---

# 05 KV Store: Run It Locally

## Run it on your machine

<!-- section: 05.local -->

Let's run it. Copy `examples/05-dynamodb/.env.example` to a file named `.env` in the same place.

<<< @/examples/05-dynamodb/.env.example

The validation of the environment variables expresses in its schema that the required variables change with where notes are stored.

<<< @/examples/05-dynamodb/src/env.ts{env}

### In memory first

Start it with the default `NOTES_STORE=memory` left as it is. No Docker, no AWS.

```bash
vp run dev:notes
```

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"draft"}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"final","body":"","expectedVersion":1}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"stale","body":"","expectedVersion":1}'
curl -s 'http://localhost:8787/notes?limit=1'
```

Replace `<id>` with the `id` from the first response. The second command returns the note at version 2, and the third returns a 409 together with the stored note.

The in-memory implementation is enough for checking the shape and the rules of the API. It tells you nothing about DynamoDB itself, though.

### Against DynamoDB Local

DynamoDB Local is a simulation of DynamoDB distributed by AWS. It runs as a container. It requires a running Docker daemon, which doesn't come with the devShell.

```bash
vp run db:local:start
vp run db:migrate:local
vp run db:seed:local
```

`db:migrate:local` creates the table, and `db:seed:local` loads the notes in `test/fixtures/seed-notes.json`. Change `NOTES_STORE` in `.env` to `dynamodb` and start `vp run dev:notes`, and the API uses this table. To start over, run `vp run db:reset:local`; to stop and remove the container, run `vp run db:local:stop`.

These tasks refuse to run unless the endpoint is `localhost`. You can't delete a table in real AWS by accident.

Compared with local development on D1, there are two differences. With D1, starting `wrangler dev` is all it takes to have a local database, whereas here you start the simulation yourself. And D1 migrations apply SQL files in order, whereas DynamoDB has no column definitions, and the only thing you decide for the table is the keys. The local table is created by `scripts/local-db.ts`, and the table on AWS by CDK. These two definitions are kept in sync by hand.

DynamoDB Local is still only a simulation. You can check that the expressions are accepted and that they behave as intended on a single machine. It doesn't reproduce IAM, throttling, or the replication and latency of the real service.

To be honest, the DynamoDB Local tasks in this section haven't been run yet. A Docker daemon wasn't available at the time of writing.

## Tests

<!-- section: 05.tests -->

```bash
vp run test:unit
vp run test:local:dynamodb
```

The tests come in five layers. Each one looks at something different.

| Layer | File | What it looks at | What it can't see |
| --- | --- | --- | --- |
| Contract (in memory) | `test/repository-contract.ts`, `test/memory-repository.test.ts` | The rules of the repository: no overwrites, the version, paging, separation between owners, the limit on the count | DynamoDB's behavior |
| Request inspection | `test/dynamodb-repository.test.ts` | The condition expressions, key shapes, and consistency settings sent to DynamoDB. Handling of a failed condition | That DynamoDB behaves as those requests ask |
| Contract (DynamoDB Local) | `test/dynamodb-local.test.ts` | That the same rules hold on the simulation | IAM, throttling, the distributed behavior of the real service |
| App and client | `test/app.test.ts` | 409, paging, rejection of a forged cursor, the cap on the size of a list, a retry after a lost response, refusal of note 101 | Behavior when the request goes through Lambda and API Gateway |
| Infrastructure | `infra/test/notes-stack.test.ts` | That the permissions are limited to five operations and one table, the table's removal policy, and the rate caps on the table and the stage | That AWS behaves as the template says |

The contract tests state the rules once and run them for each implementation.

The DynamoDB implementation gets a stand-in for the SDK client, and the tests inspect the requests it sends. If someone removes one of the parts that carry the guarantees (`ConditionExpression`, `ConsistentRead`, the shape of the keys), this test fails. But this only confirms that "the right requests are being sent". How DynamoDB handles those requests is checked against DynamoDB Local or real AWS.

`test:local:dynamodb` fails when `DYNAMODB_ENDPOINT` is not set. The test file itself skips when there is no endpoint. A skipped test looks like a success at a glance, so the dedicated task turns it into a failure. The `1 skipped` in the output of `vp run test:unit` is this test.

For concurrent writes, the contract tests include a check that "of two writes carrying the same version, exactly one goes through". In the in-memory implementation this always holds, because the writes run one after the other inside a single process.

The limit on the count has the same kind of check: six creates sent at once where there are three places, and exactly three go through.

Let's be honest about this part. Where it really needs to be checked is on DynamoDB, and on the real DynamoDB that has never been run. On DynamoDB Local (3.3.1), the 15 contract tests passed. But the simulation runs on one machine. So the central claim of this chapter, that "a conditional write lets through exactly as many concurrent writes as it should", is unconfirmed on the real thing. The statements about DynamoDB's behavior are based on the official documentation.
