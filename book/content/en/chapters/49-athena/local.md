---
title: "49 Athena: Run It Locally"
---

# 49 Athena: Run It Locally

## What can be checked on a laptop

<!-- section: 49.local -->

Athena does not run on a laptop. For the same reason as in chapter 26, no other SQL engine stands in for it either. What runs on this page is the statement building, the client, the cost arithmetic and the stack's tests from the [previous page](/en/chapters/49-athena/build.md). Not one of this chapter's SQL statements was executed.

```bash
vp test run examples/49-athena
```

The tests check the following.

- The text of a statement does not change with a user's value. The same hostile value goes to the string-built function and to the one with parameters
- A text parameter stays inside one pair of quotes whatever its value. Only checked values reach DDL and `MERGE`
- The client waits exactly up to its bound and stops the query when it gives up. A lost response to a start still leaves one query when the `attempt` is the same. Paging through results, and cutting rows off at a maximum
- The scan and cost arithmetic. The quantities in the pricing scenarios are the values in this test
- Stack assertions: the limit, the engine version, the result location, no `*` in the role's permissions, and the resource types in use

The client's tests run against a stand-in this chapter wrote from the API reference. They are no evidence that the real Athena behaves the same way.

A statement can be printed without running it.

```bash
vp run athena:sql --name merge --from 2026-10-12 --to 2026-10-12
```

```text
MERGE INTO aih_analytics.requests_iceberg AS t
USING (
  SELECT v, event_id, at, request_id, method, route, status, duration_ms, action, note_id, min(dt) AS dt
  FROM aih_analytics.requests
  WHERE dt BETWEEN '2026-10-12' AND '2026-10-12'
  GROUP BY v, event_id, at, request_id, method, route, status, duration_ms, action, note_id
) AS s
ON t.event_id = s.event_id
WHEN NOT MATCHED
  THEN INSERT (v, event_id, at, request_id, method, route, status, duration_ms, action, note_id, dt) VALUES (s.v, s.event_id, s.at, s.request_id, s.method, s.route, s.status, s.duration_ms, s.action, s.note_id, s.dt)

parameters: []
```

`--name` takes one of ten: `route`, `create-compact`, `compact`, `scratch`, `unload`, `create-iceberg`, `merge`, `optimize`, `vacuum` and `yesterday`. In a statement that holds a location, the bucket is `amzn-s3-demo-bucket`, the name AWS's documentation uses in examples. The real name is read from the deployed stack's outputs.

The stack's synth also passes without asking AWS anything.

```bash
vp run athena:infra:synth
```
